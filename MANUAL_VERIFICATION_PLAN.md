# Manual Verification Plan

Care Finder Aotearoa is currently in development. This plan lists the manual
checks needed before public release.

## Verification Goals

- Confirm phone, email, website, address, service type, cost, eligibility, and
  current availability.
- Confirm whether the provider is taking new clients, referrals, enrolments, or
  has a waitlist.
- Confirm whether support tags are accurate: Maori, Pasifika, Asian, Rainbow,
  trauma-informed, telehealth, youth, addiction, male/female provider, and
  funded/low-cost.
- Move any provider that is not taking clients into
  `data/monitors/provider-availability-watchlist.json`.
- Update `providers.json` with a new `lastVerified` month only after a real
  source review, phone call, email reply, or provider-owned page review.

## Priority Providers By Region

| Region | First manual verification targets |
| --- | --- |
| Northland | Heartwood Psychiatry; The Starfish Clinic - Donna McEwen; The Starfish Clinic - Dr Yvette Ahmad; Xtrapsychplus; Northland Mental Health Crisis Team; Te Hau Awhiowhio o Otangarei Trust; Te Hau Ora o Ngapuhi |
| Auckland | Dr Campbell Emmerton; Dr Ian Goodwin; Dr Jane Casey; Dr John Joseph; Dr Katie Ritchie; Dr M Shanmukha Swamy Lokesh; Dr Murray Patton |
| Waikato | Dr Veronika Isler Psychological Services CBT Plus; PsychologyWorx; Qiu Yue Feng - Clinical Psychologist; The Psychology Centre; K'aute Pasifika Trust; Pinnacle Access and Choice / Te Tumu Waiora; Progress to Health Waikato |
| Bay of Plenty | Dr Caleb Armstrong; Allanah Casey; Phoenix Psychology; The Psychology Group - Tauranga; Bay Counselling and Therapy Service; Te Puna Ora o Mataatua - Nga Mata Wai Ora Counselling; Bay of Plenty Mental Health Crisis Teams |
| Rotorua and Taupo | Heads and Hearts Psychology; Psychologist.nz Rotorua Referrals; Pathways Counselling Service; Ember Rotorua and Lakes Community Support; Lifewise Rotorua Mental Health & Addiction; Progress to Health Taupo; Rotorua and Taupo Mental Health Crisis Team |
| Tairawhiti | LaNae Fisk Psychology; WellMind Psychology and Counselling; Atawhai Counselling and Supervision; Whaiora SV Specialist Services; Health NZ Tairawhiti Mental Health and Addiction Services; Tairawhiti Mental Health Crisis Team; Te Kupenga Net Trust / Te Waharoa |
| Hawke's Bay | Alive! Psychological Services; Bay Psychology; Dr Craig Colhoun Psychology; Talking Cure; Whakiao Taurima Counselling; Hawke's Bay Community Mental Health and Addiction Services; Hawke's Bay Mental Health Crisis Team |
| Taranaki | Groundwork Psychology; Integrate Psychology; Jeremy Clark Psychology; TalkingPoint; Tu Tama Wahine o Taranaki; Progress to Health Taranaki; Taranaki Mental Health Assessment and Brief Care |
| Manawatu-Whanganui | CenPsyX; Palmerston North Psychology Clinic - Massey University; M.I.S.T Whanganui; Manawatu-Whanganui Mental Health Crisis Teams; MASH Trust; Te Oranganui; THINK Hauora Access and Choice |
| Wairarapa | Capital Psychology - Wairarapa Assessments; Nicholas Allan Psychology; Briar Nicol Counselling; ChangeAbility Counselling & Family Violence Services; King Street Artworks; Pathways Masterton; Wairarapa Mental Health Crisis Team |
| Wellington | Dr Justin Barry-Walsh; Dr Kang Tan; Dr Rachel Kan; Dr Sally Rimkeit; Dr Struan Robertson; Prof Sarah Romans; Alan Hackney |
| Nelson, Marlborough and Tasman | Dr Thomas Levien; Dr Rachael Sim Clinical Psychology; Full Circle Psychology; The Nelson Clinic; Top of the South Psych Services; Care Marlborough; Health Action Trust |
| Canterbury / Christchurch | Dr Deborah Wood; Dr Evan Wilson; Dr Laura Hammersley; Dr Nicholas Pascoe; Dr Paul Edgar; Dr Samantha Chow; Dr Sue Luty |
| South Canterbury | Alice McClintock - South Coast Psychology; Reihana Psychology; A Time to Talk; Black Dog Therapy; Centrecare Waimate; Mokonui-a-rangi TALK; Arowhenua Whanau Services |
| West Coast | Kensington Clinic; West Coast Counselling; West Coast Health - Primary Health Counselling Programme; Homebuilders West Coast; PACT West Coast; Poutini Waiora; West Coast Mental Health and Addiction Services |
| Otago | Ashburn Clinic Psychiatry; Blue Harbour Mental Health; Prof Sunny Collings; Psychiatry Down South; Bernadette Berry, Delta Psychology; Drew Crannitch Psychologists; DrewCrannitch Psychologists |
| Southland | Annelize Prinsloo - South Coast Psychology; South Coast Psychology; Gore Counselling Centre; Growth Online Counselling; Health Down South Counselling; Lighthouse Southland; Loss and Grief Centre Southland |

## Thin Coverage Regions

These regions need extra provider research and manual confirmation before wider
promotion:

- Hawke's Bay: no local psychiatrist records.
- Manawatu-Whanganui: no local psychiatrist records and few psychologists.
- Rotorua and Taupo: no local psychiatrist records.
- South Canterbury: no local psychiatrist records.
- Southland: no local psychiatrist records.
- Tairawhiti: no local psychiatrist records.
- Taranaki: no local psychiatrist records.
- Waikato: no local psychiatrist records.
- Wairarapa: no local psychiatrist records.
- West Coast: no local psychologist or psychiatrist records.

## RANZCP Directory Thin-Coverage Check

Checked the Your Health in Mind / RANZCP New Zealand psychiatrist directory on
2026-05-24 for thin-coverage locations. The directory's current New Zealand
results did not add any available local psychiatrist profiles for Hawke's Bay,
Tairawhiti, Manawatu-Whanganui, Wairarapa, Rotorua and Taupo, South Canterbury,
Southland, or West Coast.

Location searches did identify two local profiles that should stay off the live
provider list until availability changes:

- Waikato / Hamilton: Dr John Collier, listed as not taking new patients.
- Taranaki / New Plymouth: Dr Roger Elliott, listed as not taking new patients.

Nearest available RANZCP directory results for several thin regions are
out-of-region, often 75 km to 250 km away. Treat those as telehealth or
manual-review fallback options rather than local listings.

## Blocked-By-Site Links Needing Human Review

The automated link checker cannot verify some sources because the site blocks
automated requests or returns a site-level access response. The 2026-05-25 link
check completed with 0 broken links and 87 blocked-by-site responses; most were
Healthpoint, Health NZ, or provider sites that still need normal-browser review
during manual verification. Review these priority sources in a normal browser:

- `https://depression.org.nz/`
- `https://info.health.nz/locations/rotorua-taupo-lakes/mental-health-addiction/adult-mhas-taupo`
- `https://info.health.nz/locations/tairawhiti-gisborne/mental-health-and-addiction-services-tairawhiti`
- `https://info.health.nz/locations/west-coast`
- `https://www.healthnz.govt.nz/health-professionals/guidance-standards/topic/mental-health-and-addiction/canterbury`
- `https://www.healthnz.govt.nz/health-topics/mental-health/crisis-assessment-teams`
- `https://www.healthnz.govt.nz/health-topics/mental-health/where-to-get-help`
- `https://www.healthnz.govt.nz/hospitals-services/hospitals/hawkes-bay/mental-health-and-addiction-services-in-hawkes-bay`
- `https://www.healthnz.govt.nz/hospitals-services/hospitals/northland/community-clinics/northland-youth-health-service`
- `https://www.healthnz.govt.nz/hospitals-services/services-support/general-practices`
- `https://www.healthnz.govt.nz/hospitals-services/services-support/health-roles/psychologists`
- `https://www.healthnz.govt.nz/locations/canterbury/urgent-mental-health-services-canterbury`
- `https://www.healthnz.govt.nz/locations/south-canterbury/integrated-primary-mental-health-addiction-ipmha`
- `https://www.otago.ac.nz/psychology/clinicalpsychologycentre`
- `https://www.wcdhb.health.nz/health-services/mental-health/`

Also manually re-check `https://www.starfishclinic.com/contact/`, which has
shown a TLS certificate hostname mismatch during source-link testing.

## Availability Recheck Failures Needing Human Review

The cautious availability recheck on 2026-05-25 could not read these watchlist
sources. Do not infer that they are accepting clients; open in a browser or
contact the provider before moving anything back into the live provider list:

- Nelson, Marlborough and Tasman: Durkin Zintl Psychology,
  `https://www.durkinzintlpsychology.co.nz/`
- Taranaki: Tosca Lammerts van Bueren Counselling,
  `https://www.counsellingnewplymouth.nz/`
- Hawke's Bay: Janneke van Rooijen Psychology,
  `https://www.jvrpsychology.com/`

## Suggested Call Script

Kia ora, I am checking public contact details for a small New Zealand mental
health support finder.

Could you please confirm:

1. Is this the right public phone number, email, website, and address for first contact?
2. Are you currently taking new clients, referrals, or enrolments?
3. Do you offer in-person, phone, or video appointments?
4. What age groups do you work with?
5. Are there common costs, funding routes, WINZ, ACC, EAP, or free/funded options people should ask about?
6. Are there support areas you publicly list, such as anxiety, depression, trauma, addiction, ADHD, youth, Maori, Pasifika, Asian, Rainbow, or family support?
7. Is there anything you would prefer this public listing to say or not say?

Thank you. We are trying to keep first-contact information accurate and low
pressure for people who may be stressed or unsure where to start.

## Suggested Email Script

Subject: Checking public provider details for Care Finder Aotearoa

Kia ora,

I am checking public contact details for Care Finder Aotearoa, a small New
Zealand mental health support finder currently in development.

Could you please confirm whether the following details are current:

- public phone:
- public email:
- website:
- address or service area:
- whether you are taking new clients/referrals/enrolments:
- in-person, phone, or video options:
- age groups:
- costs or funding options people should ask about:
- any public focus areas or eligibility notes:

If anything should be corrected or removed, please let me know.

Thank you.
