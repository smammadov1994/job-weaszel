#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCE_FILE="$SCRIPT_DIR/.deployed-resources.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; }

if [[ ! -f "$RESOURCE_FILE" ]]; then
  err "No deployment found. Missing: $RESOURCE_FILE"
  exit 1
fi

# Load config for region
if [[ -f "$SCRIPT_DIR/config.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/config.env"
  set +a
fi
AWS_REGION="${AWS_REGION:-us-east-1}"

get_res() {
  jq -r --arg k "$1" '.[$k] // empty' "$RESOURCE_FILE"
}

confirm_action() {
  local msg="$1"
  read -rp "$(echo -e "${YELLOW}$msg (y/N):${NC} ")" answer
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

echo ""
echo -e "${RED}╔════════════════════════════════════════════╗${NC}"
echo -e "${RED}║   Job Application Automation - Teardown    ║${NC}"
echo -e "${RED}╚════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${CYAN}Resources to be deleted:${NC}"
jq '.' "$RESOURCE_FILE"
echo ""

if ! confirm_action "Are you sure you want to delete ALL resources?"; then
  echo "Aborted."
  exit 0
fi

# ── Terminate EC2 Instance ───────────────────────────────────────────────────
INSTANCE_ID=$(get_res "instance_id")
if [[ -n "$INSTANCE_ID" ]]; then
  log "Terminating EC2 instance: $INSTANCE_ID"
  aws ec2 terminate-instances --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" > /dev/null 2>&1 || true
  echo "  Waiting for termination..."
  aws ec2 wait instance-terminated --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" 2>/dev/null || true
  log "Instance terminated"
fi

# ── Release Elastic IP ──────────────────────────────────────────────────────
EIP_ALLOC=$(get_res "eip_allocation_id")
if [[ -n "$EIP_ALLOC" ]]; then
  log "Releasing Elastic IP: $EIP_ALLOC"
  aws ec2 release-address --region "$AWS_REGION" --allocation-id "$EIP_ALLOC" 2>/dev/null || true
  log "Elastic IP released"
fi

# ── Delete Key Pair ──────────────────────────────────────────────────────────
KEY_NAME=$(get_res "key_name")
if [[ -n "$KEY_NAME" ]]; then
  if confirm_action "Delete EC2 key pair '$KEY_NAME'?"; then
    aws ec2 delete-key-pair --region "$AWS_REGION" --key-name "$KEY_NAME" 2>/dev/null || true
    rm -f "$SCRIPT_DIR/${KEY_NAME}.pem"
    log "Key pair deleted"
  else
    warn "Key pair kept"
  fi
fi

# ── Delete Security Group ───────────────────────────────────────────────────
SG_ID=$(get_res "security_group_id")
if [[ -n "$SG_ID" ]]; then
  log "Deleting Security Group: $SG_ID"
  # Retry because SG may have dependencies being cleaned up
  for i in {1..5}; do
    if aws ec2 delete-security-group --region "$AWS_REGION" --group-id "$SG_ID" 2>/dev/null; then
      break
    fi
    sleep 5
  done
  log "Security Group deleted"
fi

# ── Delete Subnet ───────────────────────────────────────────────────────────
SUBNET_ID=$(get_res "subnet_id")
if [[ -n "$SUBNET_ID" ]]; then
  log "Deleting Subnet: $SUBNET_ID"
  aws ec2 delete-subnet --region "$AWS_REGION" --subnet-id "$SUBNET_ID" 2>/dev/null || true
  log "Subnet deleted"
fi

# ── Delete Route Table ──────────────────────────────────────────────────────
RTB_ID=$(get_res "route_table_id")
if [[ -n "$RTB_ID" ]]; then
  log "Deleting Route Table: $RTB_ID"
  # Disassociate first
  ASSOC_IDS=$(aws ec2 describe-route-tables --region "$AWS_REGION" \
    --route-table-ids "$RTB_ID" \
    --query 'RouteTables[0].Associations[?!Main].RouteTableAssociationId' \
    --output text 2>/dev/null || echo "")
  for assoc in $ASSOC_IDS; do
    aws ec2 disassociate-route-table --region "$AWS_REGION" --association-id "$assoc" 2>/dev/null || true
  done
  aws ec2 delete-route-table --region "$AWS_REGION" --route-table-id "$RTB_ID" 2>/dev/null || true
  log "Route Table deleted"
fi

# ── Detach & Delete Internet Gateway ────────────────────────────────────────
IGW_ID=$(get_res "igw_id")
VPC_ID=$(get_res "vpc_id")
if [[ -n "$IGW_ID" ]]; then
  log "Detaching and deleting Internet Gateway: $IGW_ID"
  if [[ -n "$VPC_ID" ]]; then
    aws ec2 detach-internet-gateway --region "$AWS_REGION" \
      --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID" 2>/dev/null || true
  fi
  aws ec2 delete-internet-gateway --region "$AWS_REGION" \
    --internet-gateway-id "$IGW_ID" 2>/dev/null || true
  log "Internet Gateway deleted"
fi

# ── Delete VPC ───────────────────────────────────────────────────────────────
if [[ -n "$VPC_ID" ]]; then
  log "Deleting VPC: $VPC_ID"
  aws ec2 delete-vpc --region "$AWS_REGION" --vpc-id "$VPC_ID" 2>/dev/null || true
  log "VPC deleted"
fi

# ── Cleanup ──────────────────────────────────────────────────────────────────
rm -f "$RESOURCE_FILE"
log "Resource file removed"

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Teardown Complete - All resources deleted${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
