# Verifier Few-Shot Examples

> 这些示例为 iflow-verifier 提供校准基准，帮助做出一致的判定。

## Example 1: BLOCKER — API Feature Not Implemented

**Phase Goal**: Add user profile update API endpoint
**Task Completed**: Yes (SUMMARY.md says "Implemented PATCH /api/user/profile")

### Must-Have Truths
1. Truth: User can update their profile name
2. Truth: User can update their profile avatar
3. Truth: Validation rejects empty name

### Artifact Check
| Artifact | Level 1: EXISTS | Level 2: SUBSTANTIVE | Level 3: WIRED |
|----------|-----------------|----------------------|-----------------|
| src/app/api/user/profile/route.ts | ✅ | ❌ Returns `{ message: "Not implemented" }` with no DB logic | ❌ Not imported anywhere |

### Key Link Check
| From | To | Status |
|------|----|--------|
| PATCH route | Database update | NOT_WIRED — route exists but returns static stub |

### Verdict: BLOCKER
- Truth 1: FAILED — endpoint returns stub response
- Truth 2: FAILED — no avatar update logic
- Truth 3: FAILED — no validation middleware
- Score: 0/3 truths verified

## Example 2: PASS — Search Feature Fully Implemented

**Phase Goal**: Implement full-text search across blog posts
**Task Completed**: Yes (SUMMARY.md confirms all 4 tasks done)

### Must-Have Truths
1. Truth: Search returns matching posts ranked by relevance
2. Truth: Empty query returns helpful message, not error

### Artifact Check
| Artifact | Level 1: EXISTS | Level 2: SUBSTANTIVE | Level 3: WIRED |
|----------|-----------------|----------------------|-----------------|
| src/lib/search.ts | ✅ | ✅ Uses FTS5 with rank scoring | ✅ Called by search API |
| src/app/api/search/route.ts | ✅ | ✅ Validates input, returns ranked results | ✅ Registered in app |

### Key Link Check
| From | To | Status |
|------|----|--------|
| search.ts | FTS5 index | WIRED — query uses MATCH + rank |
| API route | search.ts | WIRED — imports and calls search() |

### Verdict: PASS
- Truth 1: VERIFIED — FTS5 MATCH with bm25 ranking
- Truth 2: VERIFIED — empty query returns 400 with guidance
- Score: 2/2 truths verified

## Example 3: WARNING — Component Exists, Data Source Uncertain

**Phase Goal**: Dashboard shows real-time user count
**Task Completed**: Yes (SUMMARY.md says "Dashboard component with user count")

### Must-Have Truths
1. Truth: Dashboard displays current active user count
2. Truth: Count updates without manual page refresh

### Artifact Check
| Artifact | Level 1: EXISTS | Level 2: SUBSTANTIVE | Level 3: WIRED |
|----------|-----------------|----------------------|-----------------|
| src/components/UserCount.tsx | ✅ | ✅ Renders count with WebSocket listener | ⚠️ WS URL hardcoded to localhost |
| src/hooks/useUserCount.ts | ✅ | ✅ Subscribes to WS and returns count | ⚠️ No reconnection logic |

### Key Link Check
| From | To | Status |
|------|----|--------|
| UserCount.tsx | useUserCount hook | WIRED — imports and uses hook |
| useUserCount | WebSocket server | UNCERTAIN — hardcoded URL, no env config |

### Verdict: WARNING
- Truth 1: VERIFIED — component renders count from hook
- Truth 2: PARTIAL — WS listener exists but no reconnection; hardcoded URL may fail in production
- Score: 1.5/2 truths verified
