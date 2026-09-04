export const meta = {
  name: 'bc-grants-refresh-verify',
  description: 'Re-verify due grant records against primary sources in parallel; any moved date is re-read by a second agent before it is trusted',
  phases: [
    { title: 'Verify', detail: 'one agent per batch of records, primary sources only' },
    { title: 'Confirm moves', detail: 'independent second read of every changed date' },
  ],
}

// args: { today: 'YYYY-MM-DD', due: [{id, sponsor, program, url, loi_deadline, full_deadline,
//         next_deadline, deadline_status, confidence, status}] }
const ROOT = 'C:/Users/wess2/Dropbox/claude_code/bc_grants'
const TODAY = args.today
const DUE = Array.isArray(args.due) ? args.due : []
const BATCH = 5

const RULES = `
You are re-verifying records in a breast cancer research funding database (${ROOT}/data/grants.json)
on ${TODAY}. Primary sources only: the sponsor's own page, the program announcement PDF, or
Grants.gov (api.grants.gov or grants.gov). Never an aggregator, never memory. Use WebFetch on the
record's url; if that is a landing page without dates, follow the announcement/guidelines link one
level down. Grants.gov detail pages render with JavaScript — for anything federal, prefer the API:
POST https://api.grants.gov/v1/api/search2 with {"keyword":"<opportunity number>"} or
POST https://api.grants.gov/v1/api/fetchOpportunity with {"opportunityId":<id from the url>}.

Report what the source says TODAY. Dates as YYYY-MM-DD or null. Never infer a date the page does not
state: if only the prior cycle is shown, keep the old dates and set confidence "projected".
A page that fails to load is NOT evidence a program stopped: set reachable=false, change nothing.
A program is retired only when the sponsor says so, the page is gone with no successor, or two
consecutive cycles have passed with no announcement.

While on the page, capture enrichment the sponsor posts and nothing else: awards made per cycle,
success rate, a program officer or contact, one recent awardee whose project is near ER+/HER2+
breast cancer, computational/real-world data, investigator-initiated trials, or health equity.
Leave a field null rather than guess. Write in neutral third person ("the PI"); never name anyone
other than sponsor staff listed publicly as contacts.`

const DIFF_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          reachable: { type: 'boolean' },
          source_read: { type: 'string', description: 'the exact URL(s) you actually read' },
          changed: { type: 'boolean', description: 'true if any date, status, award or eligibility fact differs from the held record' },
          loi_deadline: { type: ['string', 'null'] },
          full_deadline: { type: ['string', 'null'] },
          next_deadline: { type: ['string', 'null'], description: 'earlier FUTURE one of the two, else null' },
          deadline_status: { type: 'string', enum: ['open', 'closed-projected', 'rolling', 'not-posted', 'forecast'] },
          confidence: { type: 'string', enum: ['verified', 'projected', 'unverified'] },
          retired: { type: 'boolean' },
          retired_reason: { type: ['string', 'null'] },
          award_text: { type: ['string', 'null'], description: 'only if it changed' },
          eligibility_change: { type: ['string', 'null'], description: 'only if the eligibility language changed; what changed' },
          evidence: { type: 'string', description: 'verbatim quote(s) establishing the dates or status' },
          enrichment: {
            type: 'object',
            properties: {
              awards_per_cycle: { type: ['string', 'null'] },
              success_rate: { type: ['string', 'null'] },
              program_contact: { type: ['string', 'null'] },
              recent_awardee_note: { type: ['string', 'null'] },
            },
            required: ['awards_per_cycle', 'success_rate', 'program_contact', 'recent_awardee_note'],
          },
          notes_addendum: { type: ['string', 'null'], description: 'one or two sentences to append to notes, only if something material is new' },
          reason: { type: 'string' },
        },
        required: ['id', 'reachable', 'source_read', 'changed', 'loi_deadline', 'full_deadline', 'next_deadline',
                   'deadline_status', 'confidence', 'retired', 'retired_reason', 'award_text', 'eligibility_change',
                   'evidence', 'enrichment', 'notes_addendum', 'reason'],
      },
    },
  },
  required: ['results'],
}

const SECOND_SCHEMA = {
  type: 'object',
  properties: {
    reachable: { type: 'boolean' },
    loi_deadline: { type: ['string', 'null'] },
    full_deadline: { type: ['string', 'null'] },
    evidence: { type: 'string' },
  },
  required: ['reachable', 'loi_deadline', 'full_deadline', 'evidence'],
}

const batches = []
for (let i = 0; i < DUE.length; i += BATCH) batches.push(DUE.slice(i, i + BATCH))
log(`${DUE.length} records due, ${batches.length} batches`)

const results = await pipeline(
  batches,
  (b, _x, i) => agent(`${RULES}

Re-verify these ${b.length} records. For each, the held values are shown; report what the source
says today and whether anything changed.

${b.map(r => `- id: ${r.id}
  sponsor/program: ${r.sponsor} — ${r.program}
  url: ${r.url}
  held: loi=${r.loi_deadline} full=${r.full_deadline} next=${r.next_deadline} status=${r.deadline_status} confidence=${r.confidence}`).join('\n')}`,
    { label: `verify:batch${i + 1}`, phase: 'Verify', schema: DIFF_SCHEMA }),

  (res, b) => {
    if (!res) return b.map(r => ({ id: r.id, outcome: 'agent-failed' }))
    const held = Object.fromEntries(b.map(r => [r.id, r]))
    return parallel(res.results.map(x => () => {
      const h = held[x.id]
      if (!h) return Promise.resolve(null)
      if (!x.reachable) return Promise.resolve({ id: x.id, outcome: 'unreachable', first: x })
      const moved = x.loi_deadline !== h.loi_deadline || x.full_deadline !== h.full_deadline || x.retired
      if (!moved) return Promise.resolve({ id: x.id, outcome: 'unchanged', first: x })
      // A moved date or a retirement is re-read by an agent that has not seen the first answer.
      return agent(`${RULES}

Read ${h.url} (and its announcement page one level down if the landing page has no dates) and
report ONLY the currently stated Letter of Intent / pre-application deadline and the full
application deadline for: ${h.sponsor} — ${h.program}. Dates as YYYY-MM-DD or null. Quote the
sentence(s) that state them. Do not consult any other source.`,
        { label: `confirm:${x.id.slice(0, 30)}`, phase: 'Confirm moves', schema: SECOND_SCHEMA })
        .then(s2 => {
          if (!s2 || !s2.reachable) return { id: x.id, outcome: 'moved-unconfirmed', first: x, second: s2 }
          const agree = s2.loi_deadline === x.loi_deadline && s2.full_deadline === x.full_deadline
          return { id: x.id, outcome: agree ? 'moved-confirmed' : 'disputed', first: x, second: s2 }
        })
    })).then(list => list.filter(Boolean))
  }
)

const flat = results.flat().filter(Boolean)
const by = k => flat.filter(r => r.outcome === k)
log(`confirmed moves ${by('moved-confirmed').length}, disputed ${by('disputed').length}, unchanged ${by('unchanged').length}, unreachable ${by('unreachable').length}`)
return {
  today: TODAY,
  confirmed: by('moved-confirmed'),
  disputed: by('disputed'),
  unconfirmed: by('moved-unconfirmed'),
  unchanged: by('unchanged'),
  unreachable: by('unreachable'),
  failed: by('agent-failed').map(r => r.id),
}
