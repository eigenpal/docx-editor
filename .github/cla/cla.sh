#!/usr/bin/env bash
# CLA workflow logic. Sourced by .github/workflows/cla.yml (which calls cla_main)
# and tested by .github/cla/cla.test.sh (which sources and calls the pure
# functions). Side effects (git push, gh api) live only in cla_main.

set -euo pipefail

# 0 if $login is in space-separated $allowlist; bracket characters in bot
# names like "dependabot[bot]" are matched literally.
cla_allowlisted() {
  local login="$1" allowlist="$2"
  [[ " $allowlist " == *" $login "* ]]
}

# 0 if $user_id is already in $signatures_file's signedContributors.
cla_signed() {
  local user_id="$1" signatures_file="$2"
  local count
  count=$(jq --argjson id "$user_id" \
    '[.signedContributors[] | select(.id == $id)] | length' \
    "$signatures_file")
  [ "$count" != "0" ]
}

# Append a signature row in place. Caller is responsible for the idempotency
# check (cla_signed) before invoking — this function always appends.
cla_add_signature() {
  local name="$1" user_id="$2" ts="$3" pr="$4" signatures_file="$5"
  jq --arg name "$name" --argjson id "$user_id" --arg ts "$ts" --argjson pr "$pr" \
    '.signedContributors += [{name: $name, id: $id, signed_at: $ts, pull_request_no: $pr}]' \
    "$signatures_file" > "$signatures_file.tmp"
  mv "$signatures_file.tmp" "$signatures_file"
}

# 0 if $login is a public member of $org. Returns 1 for non-members, private
# members (default GITHUB_TOKEN can't see them), unknown orgs, and API errors —
# fail-closed: anyone not provably an org member must sign once.
# Tests override this function with a stub.
cla_org_member() {
  local login="$1" org="$2"
  [ -z "$org" ] && return 1
  gh api "orgs/$org/members/$login" --silent 2>/dev/null
}

# 0 if $login should be skipped from the CLA check entirely (no JSON row,
# no comment listing, no warning) — either because they're on the literal
# allowlist or because they're a public member of $org.
cla_should_skip() {
  local login="$1" allowlist="$2" org="${3:-}"
  cla_allowlisted "$login" "$allowlist" && return 0
  [ -n "$org" ] && cla_org_member "$login" "$org" && return 0
  return 1
}

# Render the unsigned-contributors comment. Wording matches the templates from
# contributor-assistant/github-action so the experience is familiar to anyone
# who has signed a CLA at another OSS project.
#
# Usage: cla_render_unsigned_comment <cla_url> <sign_phrase> <marker> <status_json>
#   status_json: {"signed":["alice"], "unsigned":["bob"], "unknown":[{"name":"X","email":"x@y"}]}
# Note: allowlisted and org members are excluded from signed/unsigned by the caller.
# Unknown = commits whose email isn't linked to any GitHub account; surfaced as a
# warning per the original action, but doesn't gate the check.
cla_render_unsigned_comment() {
  local cla_url="$1" sign_phrase="$2" marker="$3" status_json="$4"
  local signed_count unsigned_count unknown_count total you matrix="" unknown_section=""
  signed_count=$(echo "$status_json" | jq '.signed | length')
  unsigned_count=$(echo "$status_json" | jq '.unsigned | length')
  unknown_count=$(echo "$status_json" | jq '(.unknown // []) | length')
  total=$((signed_count + unsigned_count))
  if [ "$total" -gt 1 ]; then
    you="you all"
    matrix=$(printf '\n\n**%d** out of **%d** committers have signed the CLA.' "$signed_count" "$total")
    while IFS= read -r login; do
      [ -z "$login" ] && continue
      matrix+=$(printf '<br/>:white_check_mark: [%s](https://github.com/%s)' "$login" "$login")
    done < <(echo "$status_json" | jq -r '.signed[]')
    while IFS= read -r login; do
      [ -z "$login" ] && continue
      matrix+=$(printf '<br/>:x: @%s' "$login")
    done < <(echo "$status_json" | jq -r '.unsigned[]')
  else
    you="you"
  fi
  if [ "$unknown_count" -gt 0 ]; then
    local seem names
    [ "$unknown_count" -gt 1 ] && seem="seem" || seem="seems"
    names=$(echo "$status_json" | jq -r '(.unknown // []) | map(.name) | join(", ")')
    unknown_section=$(printf '\n\n**%s** %s not to be a GitHub user. You need a GitHub account to be able to sign the CLA. If you have already a GitHub account, please [add the email address used for this commit to your account](https://help.github.com/articles/why-are-my-commits-linked-to-the-wrong-user/#commits-are-not-linked-to-any-user).' "$names" "$seem")
  fi
  cat <<EOF
Thank you for your submission, we really appreciate it. Like many open-source projects, we ask that ${you} sign our [Contributor License Agreement](${cla_url}) before we can accept your contribution. You can sign the CLA by just posting a Pull Request Comment same as the below format.

---

${sign_phrase}

---
${matrix}${unknown_section}

<sub>You can retrigger this bot by commenting **cla-recheck** in this Pull Request.</sub>
<sub>Posted by the CLA bot.</sub>

${marker}
EOF
}

cla_render_signed_comment() {
  local marker="$1"
  cat <<EOF
All contributors have signed the CLA  ✍️ ✅

<sub>Posted by the CLA bot.</sub>

${marker}
EOF
}

cla_init_signatures() {
  local signatures_file="$1"
  mkdir -p "$(dirname "$signatures_file")"
  [ -f "$signatures_file" ] || echo '{"signedContributors":[]}' > "$signatures_file"
}

# Orchestrates the full workflow. The only function with side effects.
# Required env: REPO, PR_NUMBER, EVENT_NAME, ALLOWLIST, CLA_URL, SIGN_PHRASE.
# Required env when EVENT_NAME=issue_comment: COMMENT_USER_LOGIN, COMMENT_USER_ID.
cla_main() {
  local signatures="signatures/version1/cla.json"
  local marker='<!-- cla-bot -->'

  cla_init_signatures "$signatures"

  # Record signature first if this run was triggered by a sign comment.
  # Skipped for: allowlisted bots/maintainers, org members, and signers
  # already on file. Idempotent across all three cases.
  if [ "${EVENT_NAME:-}" = "issue_comment" ]; then
    if cla_should_skip "$COMMENT_USER_LOGIN" "$ALLOWLIST" "${CLA_ORG:-}"; then
      :  # allowlisted or org member — no JSON row needed
    elif ! cla_signed "$COMMENT_USER_ID" "$signatures"; then
      cla_add_signature "$COMMENT_USER_LOGIN" "$COMMENT_USER_ID" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PR_NUMBER" "$signatures"
      git config user.name "github-actions[bot]"
      git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
      git add "$signatures"
      git commit -m "Record CLA signature for @${COMMENT_USER_LOGIN} (PR #${PR_NUMBER})"
      # If you enable branch protection on `main` with require-pull-request,
      # this push will start failing. Allow `github-actions[bot]` to bypass
      # protection in the branch ruleset, OR move the signatures file to a
      # dedicated repo and update the checkout step accordingly.
      git push origin main
    fi
  fi

  # Fetch commit authors via GraphQL — `gh pr view --json commits` flattens
  # author info and gives node IDs instead of numeric database IDs, which
  # don't match the IDs we record in signatures.json. The GraphQL `databaseId`
  # is the stable numeric user ID we need, and the nested `user` field
  # correctly distinguishes linked from unlinked commit emails.
  local pr_data commits_json authors_json unknown_json signed_logins unsigned_logins status_json head_sha
  pr_data=$(gh api graphql \
    -F owner="${REPO%/*}" -F name="${REPO#*/}" -F number="$PR_NUMBER" \
    -f query='
      query($owner:String!, $name:String!, $number:Int!) {
        repository(owner:$owner, name:$name) {
          pullRequest(number:$number) {
            headRefOid
            commits(first:100) {
              nodes { commit { author { email name user { login databaseId } } } }
            }
          }
        }
      }')
  head_sha=$(echo "$pr_data" | jq -r '.data.repository.pullRequest.headRefOid')
  commits_json=$(echo "$pr_data" | jq -c '.data.repository.pullRequest.commits')
  # Linked authors → {login, id}. databaseId is the numeric stable ID.
  authors_json=$(echo "$commits_json" | jq -c \
    '[.nodes[].commit.author | select(.user != null) | {login: .user.login, id: .user.databaseId}] | unique_by(.id)')
  # Unknown = commit authors with no linked GitHub user. Dedup by name<email>.
  unknown_json=$(echo "$commits_json" | jq -c \
    '[.nodes[].commit.author | select(.user == null) | {name: .name, email: .email}] | unique_by("\(.name)<\(.email)>")')

  signed_logins=()
  unsigned_logins=()
  while IFS=$'\t' read -r login user_id; do
    if cla_should_skip "$login" "$ALLOWLIST" "${CLA_ORG:-}"; then continue; fi
    if cla_signed "$user_id" "$signatures"; then
      signed_logins+=("$login")
    else
      unsigned_logins+=("$login")
    fi
  done < <(echo "$authors_json" | jq -r '.[] | "\(.login)\t\(.id)"')

  local unknown_count
  unknown_count=$(echo "$unknown_json" | jq 'length')

  status_json=$(jq -n \
    --argjson signed   "$(printf '%s\n' "${signed_logins[@]:-}"   | jq -R . | jq -s 'map(select(length>0))')" \
    --argjson unsigned "$(printf '%s\n' "${unsigned_logins[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
    --argjson unknown  "$unknown_json" \
    '{signed: $signed, unsigned: $unsigned, unknown: $unknown}')

  # Gate matches contributor-assistant/github-action: pass/fail is based only
  # on signed-vs-unsigned. Unknown committers (commits with no linked GitHub
  # user) surface as a warning in the unsigned comment but don't block.
  local body status_state status_desc
  if [ "${#unsigned_logins[@]}" -eq 0 ]; then
    status_state="success"
    status_desc="All contributors signed the CLA"
    body=$(cla_render_signed_comment "$marker")
  else
    status_state="failure"
    status_desc="Awaiting CLA signature"
    body=$(cla_render_unsigned_comment "$CLA_URL" "$SIGN_PHRASE" "$marker" "$status_json")
  fi

  # Upsert the sticky CLA comment (one per PR, identified by the marker).
  # `--slurp` is load-bearing: `gh api --paginate` outputs one JSON array per
  # page, and without `-s` jq's `first` would only see the first page's matches.
  local existing
  existing=$(gh api "repos/${REPO}/issues/${PR_NUMBER}/comments" --paginate \
    | jq -rs --arg m "$marker" 'add | [.[] | select(.body | contains($m)) | .id] | first // empty')
  if [ -n "$existing" ]; then
    gh api -X PATCH "repos/${REPO}/issues/comments/${existing}" -f body="$body" > /dev/null
  else
    gh api -X POST "repos/${REPO}/issues/${PR_NUMBER}/comments" -f body="$body" > /dev/null
  fi

  # Set the commit status check on the PR head.
  gh api -X POST "repos/${REPO}/statuses/${head_sha}" \
    -f state="$status_state" \
    -f context="CLA" \
    -f description="$status_desc" \
    -f target_url="$CLA_URL" > /dev/null
}

# Run cla_main when this script is executed directly (from the workflow).
# Stay quiet when sourced (from the test file or an interactive shell).
if [ "${BASH_SOURCE[0]:-}" = "${0}" ]; then
  cla_main
fi
