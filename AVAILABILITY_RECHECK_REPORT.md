# Availability Recheck Report

Generated: 2026-07-16T01:42:40.229Z

## Current Behaviour Before This Change

Scheduled recheck previously existed: yes.

- Before this availability-freshness layer, unavailable providers were usually removed from providers.json and stored in data/monitors/provider-availability-watchlist.json.
- The weekly GitHub Actions workflow already ran tools/check-provider-availability.mjs against that watchlist and uploaded data/reports/provider-availability-monitor.json.
- Live providers did not have explicit availabilityStatus metadata, and the UI ranking did not use availability status directly.
- The link checker checked reachability only; it did not infer provider availability.

## Recheck Cadence

- not_accepting: recheck or flag daily until the provider reopens or the source changes
- referrals_paused: recheck or flag every 14 days
- waitlist: recheck or flag every 30 days
- unknown / not_published: review every 90 days where practical
- accepting: review daily and only use when explicit current source evidence exists

Accepting is never inferred from silence. Blocked or unreachable pages create manual review items.

## Status Counts

Live providers:

- accepting: 6
- not_published: 1176
- waitlist: 29

Unavailable watchlist:

- not_accepting: 17
- referrals_paused: 6

Regions most affected by unavailable/watchlist records:

- Auckland: 2
- Canterbury: 1
- Hawke's Bay: 2
- Manawatu-Whanganui: 1
- Nelson Marlborough Tasman: 1
- Northland: 6
- Southland: 1
- Tairawhiti: 1
- Taranaki: 5
- Waikato: 2
- West Coast: 1

Findings: 53 total, 0 high (0 unallowlisted), 53 medium, 0 low.

| Severity | Provider | Region / city | Status | Checked | Issue | Suggested action | Source | Allowlisted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| medium | christchurch-psychmed-michelle-mccarthy - Dr Michelle McCarthy | Canterbury / Christchurch | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.christchurchpsychmed.co.nz/about | no |
| medium | gp-central-family-health-care-35-7201-174-3199 - Central Family Health Care | Northland / Whangarei | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://centralfamily.co.nz/ | no |
| medium | gp-health-hub-coastal-medical-39-0434-174-1243 - Health Hub Coastal Medical | Taranaki / New Plymouth | accepting | 2026-05-25 | accepting availability is 52 days old; target cadence is 1 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.pinnacle.co.nz/practices/health-hub-coastal-medical | no |
| medium | gp-kensington-health-35-7100-174-3138 - Kensington Health | Northland / Whangarei | accepting | 2026-05-24 | accepting availability is 53 days old; target cadence is 1 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://kensingtonhealth.nz/ | no |
| medium | gp-west-end-medical-centre-whang-rei-35-7311-174-3107 - West End Medical Centre | Northland / Whangarei | accepting | 2026-05-24 | accepting availability is 53 days old; target cadence is 1 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://westendmed.nz/ | no |
| medium | hawkes-bay-janneke-van-rooijen-psychology - Janneke van Rooijen Psychology | Hawke's Bay / Napier | check_failed | 2026-06-12T06:44:34.432Z | Availability recheck could not read the source (404). | Create a manual call/email/browser review item. Do not infer accepting or unavailable from a blocked page. | https://www.jvrpsychology.com/ | no |
| medium | hawkes-bay-janneke-van-rooijen-psychology - Janneke van Rooijen Psychology | Hawke's Bay / Napier | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.jvrpsychology.com/ | no |
| medium | hawkes-bay-nova-mentem-broad-streams - Nova Mentem broad psychiatry streams | Hawke's Bay / Napier | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.futureready.org.nz/listing/nova-mentem-mind-health-specialists/ | no |
| medium | marlborough-durkin-zintl-psychology - Durkin Zintl Psychology | Nelson Marlborough Tasman / Blenheim and telehealth | check_failed | 2026-06-12T06:44:34.432Z | Availability recheck could not read the source (ERR). | Create a manual call/email/browser review item. Do not infer accepting or unavailable from a blocked page. | https://www.durkinzintlpsychology.co.nz/ | no |
| medium | marlborough-durkin-zintl-psychology - Durkin Zintl Psychology | Nelson Marlborough Tasman / Blenheim and telehealth | referrals_paused | 2026-05-24 | Watchlist referrals_paused evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.durkinzintlpsychology.co.nz/ | no |
| medium | national-empath-psychology - Empath Psychology | National / Online | accepting | 2026-05-24 | accepting availability is 53 days old; target cadence is 1 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.empathpsychology.co.nz/ | no |
| medium | northland-creative-counselling-kerikeri - Creative Counselling | Northland / Kerikeri | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.creativecounselling.co.nz/services/ | no |
| medium | northland-maria-rotella-clinical-psychologist - Dr Maria Rotella | Northland / Whangarei | waitlist | 2026-05-24 | waitlist availability is 53 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.psychologytoday.com/nz/counselling/maria-rotella-whangarei-no/1134941 | no |
| medium | northland-mindme-clinical-psychology - MindMe Clinical Psychology | Northland / Mid-North and Whangarei | referrals_paused | 2026-05-24 | Watchlist referrals_paused evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.mindme.co.nz/ | no |
| medium | northland-northland-psychiatry-dr-foote - Northland Psychiatry - Dr Joseph Foote | Northland / Whangarei and telepsychiatry | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.northlandpsychiatry.co.nz/ | no |
| medium | northland-steven-smithson-counselling - Steven Smithson Counselling | Northland / Whangarei | accepting | 2026-05-24 | accepting availability is 53 days old; target cadence is 1 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://findatherapist.nz/listing/mr-steven-smithson-mnzac | no |
| medium | northland-wayfinder-psychology - Wayfinder Psychology | Northland / Whangarei | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://wayfinderpsychology.co.nz/ | no |
| medium | northland-whangarei-care-centre-counselling - Whangarei Care Centre Counselling | Northland / Whangarei | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://whgcare.org.nz/counselling-whangarei/ | no |
| medium | psychiatry-nz-jimi-macmillan - Dr Jimi MacMillan | National / Telehealth across New Zealand | waitlist | 2026-06-12 | waitlist availability is 34 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://psychiatry.nz/ | no |
| medium | ranzcp-1363 - Dr Roger Elliott | Taranaki / Oakura | referrals_paused | 2026-05-24 | Watchlist referrals_paused evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/1363/dr-roger-elliott | no |
| medium | ranzcp-2586 - Dr John Collier | Waikato / HAMILTON CBD | referrals_paused | 2026-05-24 | Watchlist referrals_paused evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/2586/dr-john-collier | no |
| medium | ranzcp-2665 - Dr Ian Goodwin | Auckland / Auckland | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/2665/dr-ian-goodwin | no |
| medium | ranzcp-2745 - Dr Jane Casey | Auckland / Ponsonby | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/2745/dr-jane-casey | no |
| medium | ranzcp-3038 - Dr Justin Barry-Walsh | Wellington / Khandallah | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/3038/dr-justin-barry-walsh | no |
| medium | ranzcp-3358 - Dr Sara Weeks | Auckland / Mt Eden | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/3358/dr-sara-weeks | no |
| medium | ranzcp-4171 - Prof Sunny Collings | Wellington / Kumutoto | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/4171/prof-sunny-collings | no |
| medium | ranzcp-4371 - Dr Thomas Levien | Nelson Marlborough Tasman / Nelson | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/4371/dr-thomas-levien | no |
| medium | ranzcp-4472 - Dr Patrick Daniels | Auckland / Remuera | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/4472/dr-patrick-daniels | no |
| medium | ranzcp-4499 - Dr Campbell Emmerton | Auckland / Herne Bay | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/4499/dr-campbell-emmerton | no |
| medium | ranzcp-4807 - Dr Scott Chambers | Auckland / Remuera | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/4807/dr-scott-chambers | no |
| medium | ranzcp-4827 - Dr Tanya Wright | Auckland / Mt Eden | referrals_paused | 2026-05-24 | Watchlist referrals_paused evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/4827/dr-tanya-wright | no |
| medium | ranzcp-4859 - Dr Katie Ritchie | Auckland / Remuera | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/4859/dr-katie-ritchie | no |
| medium | ranzcp-4946 - Dr Paul Edgar | Canterbury / Ilam | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/4946/dr-paul-edgar | no |
| medium | ranzcp-5226 - Prof Cameron Lacey | Canterbury / Bromley | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/5226/prof-cameron-lacey | no |
| medium | ranzcp-5481 - Dr Sally Rimkeit | Wellington / Hataitai | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/5481/dr-sally-rimkeit | no |
| medium | ranzcp-5542 - Dr Vernon Reynolds | Northland / Whangarei | waitlist | 2026-05-24 | waitlist availability is 53 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/5542/dr-vernon-reynolds | no |
| medium | ranzcp-5617 - Dr Helen Austin | Nelson Marlborough Tasman / Blenheim | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/5617/dr-helen-austin | no |
| medium | ranzcp-576 - Dr Murray Patton | Auckland / Milford | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/576/dr-murray-patton | no |
| medium | ranzcp-5889 - Dr Struan Robertson | Wellington / CBD | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/5889/dr-struan-robertson | no |
| medium | ranzcp-6009 - Dr Rachel Kan | Wellington / Wellington Central | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/6009/dr-rachel-kan | no |
| medium | ranzcp-6743 - Dr Caleb Armstrong | Bay of Plenty / Gate Pa | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/6743/dr-caleb-armstrong | no |
| medium | ranzcp-7045 - Dr Neena Joseph | Auckland / Avondale | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/7045/dr-neena-joseph | no |
| medium | ranzcp-7734 - Dr M Shanmukha Swamy Lokesh | Auckland / Ellerslie | waitlist | 2026-05 | waitlist availability is 76 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.yourhealthinmind.org/find-a-psychiatrist/profile/7734/dr-m-shanmukha-swamy-lokesh | no |
| medium | southland-south-coast-psychology-psychiatry - South Coast Psychology Psychiatry | Southland / Invercargill and Gore | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://southcoastpsychology.co.nz/service/psychiatry/ | no |
| medium | tairawhiti-mauri-psychology - Mauri Psychology | Tairawhiti / Gisborne | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.mauripsychology.com/ | no |
| medium | taranaki-calming-minds-dr-candy-fox - Calming Minds | Taranaki / Rural Taranaki | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://calmingminds.co.nz/ | no |
| medium | taranaki-jade-psychology - Jade Psychology | Taranaki / New Plymouth | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.jade-psychology.com/contact | no |
| medium | taranaki-tosca-counselling - Tosca Lammerts van Bueren Counselling | Taranaki / New Plymouth | check_failed | 2026-06-12T06:44:34.432Z | Availability recheck could not read the source (404). | Create a manual call/email/browser review item. Do not infer accepting or unavailable from a blocked page. | https://www.counsellingnewplymouth.nz/ | no |
| medium | taranaki-tosca-counselling - Tosca Lammerts van Bueren Counselling | Taranaki / New Plymouth | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.counsellingnewplymouth.nz/ | no |
| medium | waikato-talkingpoint-cambridge - TalkingPoint Cambridge | Waikato / Cambridge | accepting | 2026-05 | accepting availability is 76 days old; target cadence is 1 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.talkingpoint.co.nz/cambridge/ | no |
| medium | waikato-waikato-counselling - Waikato Counselling | Waikato / Hamilton | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.waikatocounselling.net/ | no |
| medium | wellington-clinical-psychology-practice - Wellington Clinical Psychology Practice | Wellington / Wellington CBD | waitlist | 2026-05-24 | waitlist availability is 53 days old; target cadence is 30 days. | Recheck the provider source or add a manual review item. Do not infer accepting from silence. | https://www.wcpp.org.nz/contact/ | no |
| medium | west-coast-internal-growth-holistic-psychology - Internal Growth Holistic Psychology | West Coast / Greymouth | not_accepting | 2026-05-24 | Watchlist not_accepting evidence is 53 days old; target cadence is 1 days. | Run the autonomous source recheck. Keep the provider suppressed unless explicit reopening evidence passes validation. | https://www.internalgrowth.co.nz/ | no |

