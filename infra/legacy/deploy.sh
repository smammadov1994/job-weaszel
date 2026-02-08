#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESOURCE_FILE="$SCRIPT_DIR/.deployed-resources.json"
TAG_KEY="Project"
TAG_VALUE="job-apply"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

# ── Load config ──────────────────────────────────────────────────────────────
load_config() {
  local config_file="$SCRIPT_DIR/config.env"
  if [[ ! -f "$config_file" ]]; then
    err "Config file not found. Copy config.env.example to config.env and fill in values:"
    err "  cp $SCRIPT_DIR/config.env.example $SCRIPT_DIR/config.env"
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$config_file"
  set +a
}

# ── Pre-flight checks ───────────────────────────────────────────────────────
preflight() {
  if ! command -v aws &>/dev/null; then
    err "AWS CLI not found. Install it: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
  fi

  if ! aws sts get-caller-identity &>/dev/null; then
    err "AWS CLI not configured. Run: aws configure"
    exit 1
  fi

  if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    err "ANTHROPIC_API_KEY is required in config.env"
    exit 1
  fi

  # Auto-detect public IP if not set
  if [[ -z "${MY_IP:-}" ]]; then
    MY_IP=$(curl -s https://checkip.amazonaws.com | tr -d '\n')
    log "Auto-detected public IP: $MY_IP"
  fi

  # Auto-generate gateway token if not set
  if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
    OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32)
    log "Auto-generated gateway token"
  fi

  # Auto-detect Ubuntu 24.04 AMI if not set
  if [[ -z "${EC2_AMI:-}" ]]; then
    EC2_AMI=$(aws ec2 describe-images \
      --region "$AWS_REGION" \
      --owners 099720109477 \
      --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" \
                "Name=state,Values=available" \
      --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
      --output text)
    log "Auto-detected AMI: $EC2_AMI"
  fi
}

# ── Save resource ID ────────────────────────────────────────────────────────
save_resource() {
  local key="$1" value="$2"
  if [[ ! -f "$RESOURCE_FILE" ]]; then
    echo '{}' > "$RESOURCE_FILE"
  fi
  local tmp
  tmp=$(jq --arg k "$key" --arg v "$value" '.[$k] = $v' "$RESOURCE_FILE")
  echo "$tmp" > "$RESOURCE_FILE"
}

tag_resource() {
  local resource_id="$1"
  aws ec2 create-tags --region "$AWS_REGION" \
    --resources "$resource_id" \
    --tags "Key=$TAG_KEY,Value=$TAG_VALUE" 2>/dev/null || true
}

# ── VPC ──────────────────────────────────────────────────────────────────────
create_vpc() {
  log "Creating VPC (10.0.0.0/16)..."
  VPC_ID=$(aws ec2 create-vpc \
    --region "$AWS_REGION" \
    --cidr-block 10.0.0.0/16 \
    --query 'Vpc.VpcId' --output text)
  aws ec2 modify-vpc-attribute --region "$AWS_REGION" --vpc-id "$VPC_ID" --enable-dns-support
  aws ec2 modify-vpc-attribute --region "$AWS_REGION" --vpc-id "$VPC_ID" --enable-dns-hostnames
  tag_resource "$VPC_ID"
  save_resource "vpc_id" "$VPC_ID"
  log "VPC created: $VPC_ID"
}

# ── Subnet ───────────────────────────────────────────────────────────────────
create_subnet() {
  log "Creating public subnet (10.0.1.0/24)..."
  SUBNET_ID=$(aws ec2 create-subnet \
    --region "$AWS_REGION" \
    --vpc-id "$VPC_ID" \
    --cidr-block 10.0.1.0/24 \
    --availability-zone "${AWS_REGION}a" \
    --query 'Subnet.SubnetId' --output text)
  aws ec2 modify-subnet-attribute --region "$AWS_REGION" \
    --subnet-id "$SUBNET_ID" --map-public-ip-on-launch
  tag_resource "$SUBNET_ID"
  save_resource "subnet_id" "$SUBNET_ID"
  log "Subnet created: $SUBNET_ID"
}

# ── Internet Gateway ────────────────────────────────────────────────────────
create_igw() {
  log "Creating Internet Gateway..."
  IGW_ID=$(aws ec2 create-internet-gateway \
    --region "$AWS_REGION" \
    --query 'InternetGateway.InternetGatewayId' --output text)
  aws ec2 attach-internet-gateway --region "$AWS_REGION" \
    --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
  tag_resource "$IGW_ID"
  save_resource "igw_id" "$IGW_ID"
  log "Internet Gateway created: $IGW_ID"
}

# ── Route Table ──────────────────────────────────────────────────────────────
create_route_table() {
  log "Creating Route Table..."
  RTB_ID=$(aws ec2 create-route-table \
    --region "$AWS_REGION" \
    --vpc-id "$VPC_ID" \
    --query 'RouteTable.RouteTableId' --output text)
  aws ec2 create-route --region "$AWS_REGION" \
    --route-table-id "$RTB_ID" \
    --destination-cidr-block 0.0.0.0/0 \
    --gateway-id "$IGW_ID"
  aws ec2 associate-route-table --region "$AWS_REGION" \
    --route-table-id "$RTB_ID" --subnet-id "$SUBNET_ID" > /dev/null
  tag_resource "$RTB_ID"
  save_resource "route_table_id" "$RTB_ID"
  log "Route Table created: $RTB_ID"
}

# ── Security Group ───────────────────────────────────────────────────────────
create_security_group() {
  log "Creating Security Group..."
  SG_ID=$(aws ec2 create-security-group \
    --region "$AWS_REGION" \
    --group-name "job-apply-sg" \
    --description "Job Application Automation - SSH and noVNC" \
    --vpc-id "$VPC_ID" \
    --query 'GroupId' --output text)

  # SSH from user's IP only
  aws ec2 authorize-security-group-ingress --region "$AWS_REGION" \
    --group-id "$SG_ID" \
    --protocol tcp --port 22 --cidr "${MY_IP}/32"

  # noVNC from user's IP only
  aws ec2 authorize-security-group-ingress --region "$AWS_REGION" \
    --group-id "$SG_ID" \
    --protocol tcp --port 6080 --cidr "${MY_IP}/32"

  tag_resource "$SG_ID"
  save_resource "security_group_id" "$SG_ID"
  log "Security Group created: $SG_ID (SSH+noVNC from $MY_IP only)"
}

# ── Key Pair ─────────────────────────────────────────────────────────────────
create_key_pair() {
  local key_file="$SCRIPT_DIR/${EC2_KEY_NAME}.pem"
  if [[ -f "$key_file" ]]; then
    log "Key pair file already exists: $key_file"
    # Check if key exists in AWS
    if aws ec2 describe-key-pairs --region "$AWS_REGION" \
         --key-names "$EC2_KEY_NAME" &>/dev/null; then
      log "Key pair exists in AWS"
      return
    else
      warn "Key file exists locally but not in AWS. Importing..."
      aws ec2 import-key-pair --region "$AWS_REGION" \
        --key-name "$EC2_KEY_NAME" \
        --public-key-material fileb://<(ssh-keygen -y -f "$key_file")
      save_resource "key_name" "$EC2_KEY_NAME"
      return
    fi
  fi

  log "Creating EC2 Key Pair..."
  aws ec2 create-key-pair --region "$AWS_REGION" \
    --key-name "$EC2_KEY_NAME" \
    --query 'KeyMaterial' --output text > "$key_file"
  chmod 400 "$key_file"
  save_resource "key_name" "$EC2_KEY_NAME"
  log "Key pair created: $key_file"
}

# ── EC2 Instance ─────────────────────────────────────────────────────────────
launch_ec2() {
  log "Launching EC2 instance ($EC2_INSTANCE_TYPE)..."

  # Prepare user-data script
  local user_data_file="$SCRIPT_DIR/setup-ec2.sh"
  if [[ ! -f "$user_data_file" ]]; then
    err "setup-ec2.sh not found at $user_data_file"
    exit 1
  fi

  INSTANCE_ID=$(aws ec2 run-instances \
    --region "$AWS_REGION" \
    --image-id "$EC2_AMI" \
    --instance-type "$EC2_INSTANCE_TYPE" \
    --key-name "$EC2_KEY_NAME" \
    --subnet-id "$SUBNET_ID" \
    --security-group-ids "$SG_ID" \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":${EC2_VOLUME_SIZE},\"VolumeType\":\"gp3\"}}]" \
    --user-data file://"$user_data_file" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=$TAG_KEY,Value=$TAG_VALUE},{Key=Name,Value=job-apply-agent}]" \
    --query 'Instances[0].InstanceId' --output text)

  save_resource "instance_id" "$INSTANCE_ID"
  log "Instance launched: $INSTANCE_ID"

  info "Waiting for instance to be running..."
  aws ec2 wait instance-running --region "$AWS_REGION" --instance-ids "$INSTANCE_ID"
  log "Instance is running"
}

# ── Elastic IP ───────────────────────────────────────────────────────────────
allocate_eip() {
  log "Allocating Elastic IP..."
  EIP_ALLOC=$(aws ec2 allocate-address \
    --region "$AWS_REGION" \
    --domain vpc \
    --query 'AllocationId' --output text)
  save_resource "eip_allocation_id" "$EIP_ALLOC"

  EIP_ADDR=$(aws ec2 describe-addresses \
    --region "$AWS_REGION" \
    --allocation-ids "$EIP_ALLOC" \
    --query 'Addresses[0].PublicIp' --output text)
  save_resource "eip_address" "$EIP_ADDR"

  aws ec2 associate-address --region "$AWS_REGION" \
    --instance-id "$INSTANCE_ID" \
    --allocation-id "$EIP_ALLOC" > /dev/null

  tag_resource "$EIP_ALLOC"
  log "Elastic IP: $EIP_ADDR"
}

# ── Upload project files ────────────────────────────────────────────────────
upload_files() {
  local key_file="$SCRIPT_DIR/${EC2_KEY_NAME}.pem"

  info "Waiting for SSH to become available..."
  local retries=0
  while ! ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
    -i "$key_file" "ubuntu@$EIP_ADDR" "echo ready" &>/dev/null; do
    retries=$((retries + 1))
    if [[ $retries -ge 30 ]]; then
      err "SSH not available after 150 seconds"
      exit 1
    fi
    sleep 5
  done
  log "SSH is available"

  log "Uploading project files..."
  # Create remote directories
  ssh -o StrictHostKeyChecking=no -i "$key_file" "ubuntu@$EIP_ADDR" \
    "mkdir -p /home/ubuntu/job-apply /home/ubuntu/openclaw-workspace"

  # Upload plugin, openclaw workspace, and data
  rsync -az --progress -e "ssh -o StrictHostKeyChecking=no -i $key_file" \
    "$PROJECT_DIR/plugin/" "ubuntu@$EIP_ADDR:/home/ubuntu/job-apply/plugin/"
  rsync -az --progress -e "ssh -o StrictHostKeyChecking=no -i $key_file" \
    "$PROJECT_DIR/openclaw/" "ubuntu@$EIP_ADDR:/home/ubuntu/job-apply/openclaw/"
  rsync -az --progress -e "ssh -o StrictHostKeyChecking=no -i $key_file" \
    "$PROJECT_DIR/openclaw/workspace/" "ubuntu@$EIP_ADDR:/home/ubuntu/openclaw-workspace/"
  rsync -az --progress -e "ssh -o StrictHostKeyChecking=no -i $key_file" \
    "$PROJECT_DIR/data/" "ubuntu@$EIP_ADDR:/home/ubuntu/job-apply/data/"

  # Upload .env
  if [[ -f "$PROJECT_DIR/.env" ]]; then
    scp -o StrictHostKeyChecking=no -i "$key_file" \
      "$PROJECT_DIR/.env" "ubuntu@$EIP_ADDR:/home/ubuntu/job-apply/.env"
  fi

  # Create .env on remote from config values
  ssh -o StrictHostKeyChecking=no -i "$key_file" "ubuntu@$EIP_ADDR" bash -s <<ENVEOF
cat > /home/ubuntu/job-apply/.env <<'EOF'
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
TWOCAPTCHA_API_KEY=${TWOCAPTCHA_API_KEY:-}
OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}
WHATSAPP_ALLOW_FROM=${WHATSAPP_ALLOW_FROM:-}
EOF
ENVEOF

  log "Files uploaded"
}

# ── Wait for setup completion ────────────────────────────────────────────────
wait_for_setup() {
  local key_file="$SCRIPT_DIR/${EC2_KEY_NAME}.pem"

  info "Waiting for EC2 setup to complete (this may take 5-10 minutes)..."
  local retries=0
  while ! ssh -o StrictHostKeyChecking=no -i "$key_file" "ubuntu@$EIP_ADDR" \
    "test -f /home/ubuntu/.setup-complete" &>/dev/null; do
    retries=$((retries + 1))
    if [[ $retries -ge 60 ]]; then
      warn "Setup taking longer than expected. Check logs with:"
      warn "  ssh -i $key_file ubuntu@$EIP_ADDR 'tail -100 /var/log/cloud-init-output.log'"
      break
    fi
    sleep 10
    printf "."
  done
  echo ""

  if ssh -o StrictHostKeyChecking=no -i "$key_file" "ubuntu@$EIP_ADDR" \
    "test -f /home/ubuntu/.setup-complete" &>/dev/null; then
    log "EC2 setup complete!"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${CYAN}╔════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║   Job Application Automation - Deployer   ║${NC}"
  echo -e "${CYAN}╚════════════════════════════════════════════╝${NC}"
  echo ""

  load_config
  preflight

  if [[ -f "$RESOURCE_FILE" ]]; then
    warn "Found existing deployment at $RESOURCE_FILE"
    warn "Run teardown.sh first if you want a fresh deployment."
    read -rp "Continue anyway? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
      exit 0
    fi
  fi

  create_vpc
  create_subnet
  create_igw
  create_route_table
  create_security_group
  create_key_pair
  launch_ec2
  allocate_eip
  upload_files
  wait_for_setup

  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  Deployment Complete!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  ${CYAN}Elastic IP:${NC}  $EIP_ADDR"
  echo -e "  ${CYAN}SSH:${NC}         ssh -i $SCRIPT_DIR/${EC2_KEY_NAME}.pem ubuntu@$EIP_ADDR"
  echo -e "  ${CYAN}noVNC:${NC}       http://$EIP_ADDR:6080"
  echo -e "  ${CYAN}Dashboard:${NC}   ssh -L 8080:127.0.0.1:18789 -i $SCRIPT_DIR/${EC2_KEY_NAME}.pem ubuntu@$EIP_ADDR"
  echo -e "                 then open http://localhost:8080/plugins/job-dashboard/"
  echo ""
  echo -e "  ${YELLOW}Next steps:${NC}"
  echo -e "  1. Open noVNC at http://$EIP_ADDR:6080"
  echo -e "  2. Log into LinkedIn, Indeed, Glassdoor, ZipRecruiter in Chrome"
  echo -e "  3. SSH in and run: openclaw channels login (to pair WhatsApp)"
  echo -e "  4. Edit /home/ubuntu/openclaw-workspace/USER.md with your info"
  echo -e "  5. Upload your resume to /home/ubuntu/job-apply/data/resume.pdf"
  echo ""
}

main "$@"
