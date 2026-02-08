---
name: job-search
description: Search for software engineering jobs on LinkedIn, Indeed, Glassdoor, and ZipRecruiter
user-invocable: true
---

# Job Search Skill

Search for Software Engineering jobs across all supported platforms and return a prioritized list of matches.

## Supported Platforms

### LinkedIn
1. Navigate to `https://www.linkedin.com/jobs/`
2. Click the search box and enter the job title from USER.md target roles
3. Set location filter to the user's preferred locations
4. Apply filters:
   - **Date Posted:** Past 24 hours (for freshness)
   - **Experience Level:** Match user's years of experience
   - **Remote:** If user prefers remote, toggle "Remote" filter
   - **Easy Apply:** Toggle "Easy Apply" filter first (prioritize these)
5. Scroll through results, extracting for each job:
   - Job title
   - Company name
   - Location
   - URL (format: `https://www.linkedin.com/jobs/view/[job-id]`)
   - Whether it's Easy Apply
   - Key requirements visible in the preview
6. Click into promising jobs to read full descriptions
7. Check `check_applied` for each job URL before adding to the apply list

### Indeed
1. Navigate to `https://www.indeed.com/`
2. Enter job title in "What" field, location in "Where" field
3. Click "Find jobs"
4. Apply filters:
   - **Date Posted:** Last 24 hours
   - **Remote:** If applicable
   - **Experience Level:** If available
5. Extract job listings:
   - Job title
   - Company name
   - Location
   - URL (format: `https://www.indeed.com/viewjob?jk=[job-id]`)
   - Salary if shown
6. Click into each job to read full description
7. Check `check_applied` for each URL

### Glassdoor
1. Navigate to `https://www.glassdoor.com/Job/`
2. Enter job title and location in search fields
3. Click search
4. Apply filters:
   - **Posted:** Last day
   - **Remote/On-site:** Based on user preference
5. Extract listings:
   - Job title, company, location, URL
   - Company rating if visible
6. Check `check_applied` for each URL

### ZipRecruiter
1. Navigate to `https://www.ziprecruiter.com/`
2. Enter job title in search, set location
3. Click "Search Jobs"
4. Apply filters:
   - **Posted:** Today / Last 24 hours
   - **Remote:** If applicable
5. Extract listings:
   - Job title, company, location, URL
   - Look for "1-Click Apply" badges
6. Check `check_applied` for each URL

## Search Queries

Use these search terms based on USER.md target roles (cycle through them):
- "Software Engineer"
- "Full Stack Engineer"
- "Backend Engineer"
- "Frontend Engineer"
- "Software Developer"

## Prioritization

Order jobs to apply to by:
1. **Easy Apply / Quick Apply / 1-Click Apply** — highest priority
2. **Skills match** — jobs that match more of the user's listed skills
3. **Company reputation** — well-known companies or those with good ratings
4. **Recency** — newer postings first
5. **Salary alignment** — if salary is shown and matches user's range

## Deduplication

Before adding any job to the apply queue:
1. Call `check_applied` with the job URL
2. If already applied, skip it silently
3. Also skip if same company + same title was applied to (even different URL)

## Output

After searching, report:
- Total jobs found across all platforms
- Jobs filtered out (duplicates, experience mismatch, etc.)
- Jobs queued for application
- Begin applying using the `job-apply` skill
