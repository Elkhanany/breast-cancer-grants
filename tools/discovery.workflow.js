export const meta = {
  name: 'bc-grants-discovery',
  description: 'Find less-advertised but proven breast cancer funding: BCM internal, Rice/MDACC/TMC, national, industry, consortia',
  phases: [
    { title: 'Discover', detail: 'seven lenses search independently' },
    { title: 'Verify', detail: 'each candidate checked against its primary source' },
    { title: 'Critique', detail: 'what did the local lenses miss?' },
  ],
}

const ROOT = 'C:/Users/wess2/Dropbox/claude_code/bc_grants'
const HELD = Array.isArray(args.held) ? args.held : []   // optional; finders read grants.json directly
const TODAY = args.today

const PROFILE = `
THE INVESTIGATOR (never name or identify them; write "the PI"):
- Breast medical oncologist, MD without PhD, at Baylor College of Medicine (BCM), Houston, in the
  Dan L Duncan Comprehensive Cancer Center / Lester and Sue Smith Breast Center orbit.
- Faculty year 7+ (first appointment 2020 or earlier), fellowship completed 2019-2020, holds an
  assistant professor appointment; tenure vs non-tenure track NOT yet confirmed, so record
  track-gated awards rather than excluding them.
- Has clinical duties. Awards that forbid clinical responsibilities are ruled out.
- Four research angles, in priority order: (1) computational and real-world data (EHR, ctDNA/MRD,
  registries), (2) investigator-initiated trials, (3) translational and biomarker discovery in
  ER+/HER2+ ("triple-positive") disease, HER2 heterogeneity, endocrine resistance, ADCs,
  (4) cancer health equity.
- Institution: Texas Medical Center. Natural collaborators: Rice University, MD Anderson (MDACC),
  UTHealth Houston, Houston Methodist, Gulf Coast Consortia.`

const RULES = `
${PROFILE}

THE DATABASE already holds 228 mechanisms. Their ids, sponsors, programs and URLs are in
${ROOT}/data/grants.json — read it before searching so you do not return what is already held.
Do not return: anything whose URL or program name matches a held record; NIH parent
announcements already present; DOD BCRP or CPRIT mechanisms (all held); anything requiring a PhD
with no MD path; anything that forbids clinical duties; postdoctoral fellowships; awards limited
to institutions other than BCM (e.g. MD Anderson-internal-only) UNLESS they have an external
collaborator route, in which case say so explicitly.

WHAT COUNTS AS A FIND: a real, currently operating funding mechanism (2026-2027 cycle, or a
reliably recurring one) that a BCM breast medical oncologist at this stage could realistically
apply to or be named on, that is NOT already held, and that is either (a) less advertised
(institutional, regional, small-to-mid foundation, industry investigator-initiated, data-partner
research programs, cooperative-group career programs), or (b) advertised but missing from the set.
"Proven" means it has actually made awards — cite evidence (awardee list, press release, prior
cycle page) where you can.

METHOD: use WebSearch to find candidates, then WebFetch the sponsor's own page for each before
returning it. Return ONLY candidates you fetched a primary page for. Prefer fewer, real finds over
many speculative ones. Hard cap: 8 candidates. If a lens genuinely yields nothing new, return an
empty list — that is a valid, useful answer.

For each candidate report the primary URL, what the page actually says about dates, award size,
eligibility, and one sentence on why it matters to THIS profile. If a find is really new
information about a HELD record (a date, a new sub-program), return it with overlaps_existing_id
set so it becomes an enrichment rather than a duplicate.`

const LENSES = [
  { key: 'bcm-internal', cap: 8, prompt: `${RULES}

LENS: BCM INTRAMURAL AND INSTITUTIONAL. Everything inside Baylor College of Medicine and its
cancer center that funds faculty research: Dan L Duncan Comprehensive Cancer Center pilot and
developmental programs, Smith Breast Center SPORE Developmental Research and Career Enhancement
programs (held but unverified — enrich them if you find current terms), BCM Office of Research
seed/bridge/interim programs, the Institute for Clinical and Translational Research (ICTR /
BCM CTSA) pilot awards and KL2, Caroline Wiess Law Fund, McNair Medical Institute, Curtis and
Doris K. Hankamer Foundation awards, DeBakey awards, department-level (Medicine, Hematology-
Oncology) research awards, precision-medicine or data-science pilots, and BCM's limited-
submission portal (InfoReady) where institutionally-nominated external awards are competed.
Search bcm.edu deliberately; institutional pages are poorly indexed.` },

  { key: 'tmc-local', cap: 8, prompt: `${RULES}

LENS: TEXAS MEDICAL CENTER AND LOCAL COLLABORATION. Funding that requires or rewards a Houston
collaboration: Rice University (Rice–BCM and Rice–TMC seed funds, Rice Cancer Prevention
Institute, Ken Kennedy Institute data-science seed grants, Institute of Biosciences and
Bioengineering, Rice–MD Anderson collaborative funds, Creative Ventures), MD Anderson programs
with an external-collaborator or multi-institution route (joint BCM–MDACC calls, CPRIT-funded
multi-institution consortia, Moon Shots collaborations), Texas Medical Center institutional
programs (TMC Innovation, TMC Health Policy Institute), Gulf Coast Consortia programs beyond the
held Dunn award, UTHealth CCTS pilots open to non-UTHealth faculty, Houston Methodist joint
programs, and Houston philanthropy that funds investigator research (Houston Endowment, Brown
Foundation, Kinder, Kleberg, Lester and Sue Smith Foundation, Cancer Fighters of Houston,
The Rose, Breast Cancer Research Fund of Houston, Texas 4000).` },

  { key: 'national-quiet', cap: 8, prompt: `${RULES}

LENS: LESS-ADVERTISED NATIONAL FOUNDATIONS WITH A TRACK RECORD. Small and mid-size funders that
have made breast cancer or oncology research awards for years but do little marketing: Elsa U.
Pardee Foundation, Theresa's Research Foundation, Twisted Pink, Inflammatory Breast Cancer
Research Foundation, Dr. Susan Love Foundation, Tigerlily, Sharsheret, Nancy Owens Memorial
Foundation, Kleberg Foundation, Cancer Research Foundation (Chicago) Young Investigator,
Worldwide Cancer Research (UK, open internationally), Prevent Cancer Foundation, Emerson
Collective Cancer Research Fund, Gilead Research Scholars in Solid Tumors, Play for P.I.N.K.,
Lynn Sage, Breast Cancer Research Fund, AACR partnered awards not held (Bayer, Novocure,
Incyte, Lilly, etc.). Verify each has a current or reliably recurring cycle.` },

  { key: 'industry-data', cap: 8, prompt: `${RULES}

LENS: INDUSTRY INVESTIGATOR-INITIATED AND DATA-PARTNER PROGRAMS relevant to ER+/HER2+, ADC,
endocrine resistance, and ctDNA/MRD/real-world data. Not held: AstraZeneca externally sponsored
research (Enhertu, Dato-DXd), Daiichi Sankyo IIS, Lilly (Verzenio, imlunestrant), Novartis
(Kisqali), Gilead (Trodelvy), Seagen/Pfizer (Tukysa), Menarini/Stemline (Orserdu/elacestrant),
Arvinas, Olema, Zymeworks (zanidatamab), MacroGenics, Byondis, Merck; and the data/diagnostics
side: Guardant Health research grants, Natera (Signatera MRD) investigator collaborations,
Exact Sciences/Oncotype research, Tempus, ConcertAI, Caris Precision Oncology Alliance, Agendia,
Foundation Medicine, ASCO CancerLinQ, AACR Project GENIE data access. Genentech, Pfizer ASPIRE,
AbbVie and Flatiron are already held. Record whether each provides funding, drug, data, or all.` },

  { key: 'consortia', cap: 8, prompt: `${RULES}

LENS: COOPERATIVE GROUPS, CONSORTIA AND NETWORKS with early-career, pilot, or correlative-science
funding: Translational Breast Cancer Research Consortium (TBCRC) — including whether BCM is a
member site; ECOG-ACRIN (Young Investigator, Paul Carbone); SWOG/Hope Foundation programs beyond
the three held; NRG programs beyond the two held; Alliance beyond the held concept route; I-SPY /
Quantum Leap Healthcare Collaborative; Breast International Group; MBCproject / Count Me In;
ORIEN; NCI Cancer Screening Research Network; Cancer Moonshot networks accepting breast
correlatives; ASCO TAPUR and other pragmatic platform trials that accept investigator sub-studies.` },

  { key: 'physician-scientist', cap: 8, prompt: `${RULES}

LENS: CAREER AWARDS BUILT FOR AN MD PHYSICIAN-SCIENTIST WITH CLINICAL DUTIES at 7+ years. Not
held: Doris Duke Clinical Scientist Development Award (check the years-since-appointment cap
honestly), Harrington Discovery Institute Scholar-Innovator, ASCI Young Physician-Scientist Award,
RWJF Harold Amos Medical Faculty Development Program, NIH Loan Repayment Program (Clinical
Research, and the Health Disparities LRP) — a real mechanism worth up to $50,000/year that
nobody advertises to faculty — Gilead Research Scholars, Pfizer Global Medical Grants, Sontag /
Rita Allen / Pew (check disease scope), Cancer Research Institute beyond the held CLIP/STAR,
Lustgarten (skip), Melanoma Research Alliance (skip), Prostate Cancer Foundation (skip),
AACR-Bristol Myers Squibb, Conquer Cancer awards not yet held. Mark career caps precisely.` },

  { key: 'federal-adjacent', cap: 8, prompt: `${RULES}

LENS: FEDERAL AND FEDERAL-ADJACENT MECHANISMS OUTSIDE THE HELD SET. AIM-AHEAD (NIH AI/ML
consortium for health equity — data, RWD, and equity in one place), NIMHD R01/R21 equity
mechanisms, NCI Cancer Moonshot RFAs touching ctDNA/MRD or pragmatic trials, NCI pragmatic
trials PAR, NCI IMAT, NCI EGRP cohort consortia, NIH Common Fund Bridge2AI, FDA Oncology Center
of Excellence real-world-evidence BAAs, FDA Sentinel/RWE demonstration projects, PCORI cycles not
already held (six PCORI records exist — check them first), NSF programs beyond the held SCH,
Cancer Moonshot Scholars, NCI K-to-R transition supplements, NCI diversity supplements the PI
could sponsor. Use Grants.gov (api.grants.gov search2, or the site) as the source of truth for
anything federal; NIH stopped posting to the NIH Guide in FY2026.` },

  { key: 'pharma-rfp', cap: 8, prompt: `${RULES}

LENS: PHARMA AND DIAGNOSTICS REQUESTS FOR PROPOSALS THAT ARE OPEN NOW. Investigator-initiated
study portals are already held for most sponsors; this lens is about the time-limited, asset-
specific calls those sponsors post on top of the standing portal and rarely advertise: Merck's
MISP areas of interest and any sacituzumab tirumotecan (sac-TMT, MK-2870) or Keytruda breast
RFP; Gilead's periodic oncology RFPs (Trodelvy / sacituzumab govitecan, Research Scholars);
Pfizer Competitive Grants Program calls and ISR oncology areas of interest (tucatinib,
vepdegestrant, atirmociclib); AstraZeneca ESR calls (Enhertu, Dato-DXd, camizestrant, Truqap);
Daiichi Sankyo; Lilly (imlunestrant, Verzenio); Novartis (Kisqali); Roche/Genentech
(giredestrant, Phesgo); Menarini/Stemline (Orserdu); Arvinas; Olema; Zymeworks; BMS; Jazz; Eisai;
and diagnostics/data RFPs (Exact Sciences, Agendia, Guardant, Natera, Tempus, Caris, Foundation
Medicine). For each, return ONLY a call that is open or announced with a window — not the standing
portal — with its exact scope, submission window, and what it provides (funding, drug, data).
Fetch the sponsor's own RFP page; many portals are JavaScript applications that return little to
a plain fetch — if WebFetch shows nothing, say so in lens_notes rather than guessing.
Never write any file inside ${ROOT}; use only your scratch directory.` },
]

const FINDS_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sponsor: { type: 'string', description: 'short name as the site would show it, e.g. "Pardee Foundation"' },
          sponsor_full: { type: 'string' },
          program: { type: 'string' },
          url: { type: 'string', description: 'the primary sponsor page you fetched' },
          category: { type: 'string', enum: ['government', 'state', 'institutional', 'foundation', 'trial-funding', 'organization'] },
          tier: { type: 'string', enum: ['early-career', 'mid-size', 'program-large'] },
          provides: { type: 'string', description: 'funding | drug | data | funding+drug | funding+data ...' },
          dates_text: { type: 'string', description: 'exactly what the page says about deadlines, verbatim where possible' },
          award_text: { type: 'string' },
          eligibility_text: { type: 'string' },
          evidence: { type: 'string', description: 'a short verbatim quote from the page' },
          why_relevant: { type: 'string', description: 'one sentence tying it to the PI\'s angles' },
          proven: { type: 'string', description: 'evidence it has made awards: awardee list, press, prior cycle' },
          overlaps_existing_id: { type: 'string', description: 'set if this is really new info about a held record; else empty' },
        },
        required: ['sponsor', 'sponsor_full', 'program', 'url', 'category', 'tier', 'provides', 'dates_text',
                   'award_text', 'eligibility_text', 'evidence', 'why_relevant', 'proven', 'overlaps_existing_id'],
      },
    },
    lens_notes: { type: 'string', description: 'what you searched and what came up empty; two or three sentences' },
  },
  required: ['candidates', 'lens_notes'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    real: { type: 'boolean', description: 'the program exists and the URL is its primary page' },
    active: { type: 'boolean', description: 'accepting applications in 2026-27, or reliably recurring' },
    eligible_plausible: { type: 'boolean', description: 'a BCM MD assistant professor, 7+ yrs, with clinical duties could apply or be named' },
    duplicate_of_held_id: { type: 'string', description: 'id of a held record if this is really the same mechanism; else empty' },
    loi_deadline: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
    full_deadline: { type: ['string', 'null'] },
    next_deadline: { type: ['string', 'null'], description: 'earlier future one of the two, or null' },
    deadline_status: { type: 'string', enum: ['open', 'closed-projected', 'rolling', 'not-posted', 'forecast'] },
    cycle: { type: 'string', description: 'annual | semiannual | rolling | one-time | unknown' },
    typical_month: { type: 'string' },
    award_usd: { type: ['number', 'null'] },
    award_text: { type: 'string' },
    duration_years: { type: ['number', 'null'] },
    indirects: { type: 'string' },
    eligibility: { type: 'string', description: 'two to four sentences, factual' },
    career_cap: { type: ['string', 'null'] },
    limited_submission: { type: 'boolean' },
    track_gate: { type: ['string', 'null'], description: 'exactly "requires tenure-track" or "requires NON-tenure-track" or null' },
    verdict: { type: 'string', enum: ['eligible', 'needs-check', 'track-gated', 'ruled-out'] },
    flags: { type: 'array', items: { type: 'string' } },
    focus: { type: 'array', items: { type: 'string' }, description: 'from: computational, iit, translational, equity, clinical, basic, drug-supply, pilot, cooperative-group, career-development' },
    breast_specific: { type: 'boolean' },
    er_her2_fit: { type: 'string', enum: ['high', 'medium', 'low'] },
    fit: { type: 'number', description: '0-140 composite: disease relevance, angle overlap, award size, deadline proximity, eligibility standing' },
    confidence: { type: 'string', enum: ['verified', 'projected', 'unverified'] },
    notes: { type: 'string', description: 'four to eight sentences in the database voice: what it is, why it matters to this profile, the trap to avoid, what to do next. Third person, "the PI".' },
    evidence: { type: 'string', description: 'verbatim quote(s) from the primary page with what they establish' },
    reason: { type: 'string', description: 'why you reached these conclusions; what you could not confirm' },
  },
  required: ['real', 'active', 'eligible_plausible', 'duplicate_of_held_id', 'loi_deadline', 'full_deadline',
             'next_deadline', 'deadline_status', 'cycle', 'typical_month', 'award_usd', 'award_text', 'duration_years',
             'indirects', 'eligibility', 'career_cap', 'limited_submission', 'track_gate', 'verdict', 'flags', 'focus',
             'breast_specific', 'er_her2_fit', 'fit', 'confidence', 'notes', 'evidence', 'reason'],
}

const norm = s => (s || '').toLowerCase().replace(/https?:\/\/(www\.)?/, '').replace(/[^a-z0-9]+/g, ' ').trim()
const heldUrls = new Set(HELD.map(h => norm(h.url)))
const heldProgs = new Set(HELD.map(h => norm(h.sponsor + ' ' + h.program)))

// Discover -> per-candidate verify, pipelined so slow lenses do not hold up fast ones.
const seen = new Set()
const results = await pipeline(
  LENSES,
  L => agent(L.prompt, { label: `find:${L.key}`, phase: 'Discover', schema: FINDS_SCHEMA }),
  (found, L) => {
    if (!found) return { lens: L.key, notes: 'lens agent failed', verified: [] }
    const fresh = []
    for (const c of found.candidates.slice(0, L.cap)) {
      const ku = norm(c.url), kp = norm(c.sponsor + ' ' + c.program)
      if (!c.overlaps_existing_id && (heldUrls.has(ku) || heldProgs.has(kp))) continue
      if (seen.has(ku) || seen.has(kp)) continue
      seen.add(ku); seen.add(kp); fresh.push(c)
    }
    log(`${L.key}: ${found.candidates.length} found, ${fresh.length} new after dedup`)
    return parallel(fresh.map(c => () =>
      agent(`${PROFILE}

VERIFY THIS CANDIDATE against its primary source. Your default is scepticism: WebFetch the URL
below (and one level of linked program/eligibility/announcement pages if needed) and confirm
what the page actually says TODAY, ${TODAY}. Do not trust the finder's summary; re-derive
every field from the page. If the page is unreachable, set confidence "unverified" and say so.
Check ${ROOT}/data/grants.json for a held record that is really the same mechanism; if so, set
duplicate_of_held_id and still fill the fields (they may enrich the held record).

CANDIDATE (from lens "${L.key}"):
  sponsor:      ${c.sponsor} — ${c.sponsor_full}
  program:      ${c.program}
  url:          ${c.url}
  provides:     ${c.provides}
  dates (claimed):  ${c.dates_text}
  award (claimed):  ${c.award_text}
  eligibility (claimed): ${c.eligibility_text}
  why relevant: ${c.why_relevant}
  proven:       ${c.proven}
  overlaps held id: ${c.overlaps_existing_id || 'none'}

Never write any file inside ${ROOT}; use only your scratch directory.
Fill every field of the schema from what you can establish. Dates as YYYY-MM-DD or null; never
guess a date the page does not state — use deadline_status "not-posted" and typical_month instead.
Write notes and eligibility in neutral third person ("the PI"). Never name the investigator.`,
        { label: `verify:${L.key}:${c.sponsor.slice(0, 22)}`, phase: 'Verify', schema: VERIFY_SCHEMA })
        .then(v => v ? { lens: L.key, candidate: c, v } : null)
    )).then(vs => ({ lens: L.key, notes: found.lens_notes, verified: vs.filter(Boolean) }))
  }
)

const lenses = results.filter(Boolean)
const kept = lenses.flatMap(r => r.verified).filter(x => x.v.real)
log(`${kept.length} candidates survive verification as real programs`)

// Local lenses are the user's stated priority: ask what they missed.
phase('Critique')
const localFound = lenses.filter(r => r.lens === 'bcm-internal' || r.lens === 'tmc-local')
  .flatMap(r => r.verified).map(x => `${x.candidate.sponsor}: ${x.candidate.program}`)
const critique = await agent(`${RULES}

Two lenses just searched for BCM-internal and Texas Medical Center / Houston collaboration funding
and found these (after removing what the database already held):
${localFound.map(s => '  - ' + s).join('\n') || '  (nothing new)'}

The database's held local/institutional records are in ${ROOT}/data/grants.json — grep it for
bcm, baylor, duncan, smith, cprit, rice, anderson, houston, tmc, gulf coast, cullen, methodist.

You are the completeness critic. What obvious BCM, Duncan Cancer Center, Rice, MD Anderson, or
Houston-philanthropy funding routes are missing from BOTH lists? Search for them and WebFetch a
primary page for each before naming it. Return only what you confirmed exists. Same schema and
same 8-candidate cap.`, { label: 'critic:local-gaps', phase: 'Critique', schema: FINDS_SCHEMA })

let extra = []
if (critique && critique.candidates.length) {
  const fresh = critique.candidates.filter(c => {
    const ku = norm(c.url), kp = norm(c.sponsor + ' ' + c.program)
    if (heldUrls.has(ku) || heldProgs.has(kp) || seen.has(ku) || seen.has(kp)) return false
    seen.add(ku); seen.add(kp); return true
  })
  log(`critic surfaced ${fresh.length} additional local candidates`)
  extra = (await parallel(fresh.map(c => () =>
    agent(`${PROFILE}

VERIFY THIS CANDIDATE against its primary source, today ${TODAY}. WebFetch ${c.url} and re-derive
every field from what the page says. Check ${ROOT}/data/grants.json for a held record that is the
same mechanism and set duplicate_of_held_id if so. Never guess a date the page does not state.
Neutral third person ("the PI"); never name the investigator.

CANDIDATE (from the completeness critic):
  ${c.sponsor} — ${c.sponsor_full}: ${c.program}
  url: ${c.url}
  claimed dates: ${c.dates_text}
  claimed award: ${c.award_text}
  claimed eligibility: ${c.eligibility_text}
  why relevant: ${c.why_relevant}
  proven: ${c.proven}`,
      { label: `verify:critic:${c.sponsor.slice(0, 22)}`, phase: 'Critique', schema: VERIFY_SCHEMA })
      .then(v => v ? { lens: 'critic', candidate: c, v } : null)
  ))).filter(Boolean).filter(x => x.v.real)
}

return {
  today: TODAY,
  lenses: lenses.map(r => ({ lens: r.lens, notes: r.notes, found: r.verified.length })),
  critic_notes: critique ? critique.lens_notes : null,
  candidates: [...kept, ...extra],
}
