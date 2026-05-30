# BINs verification

Source: 12-attachment email from Dora D. LaGrande (Global Property Management Group), 2026-05-27.

Summary: **12 properties**, **70 buildings**, **965 units**, **5 missing BINs**.

If `missing BINs > 0`, the agent could not read the handwritten BIN for one or more buildings — re-render at higher DPI or request a re-scan.

---


## DONNALOUISE — (name not extracted)

- Operator entity: Community Development Programs Center of Nevada - Donna Louise, LLC dba Donna Louise apts.
- Source: `DONNALOUISE BIN.pdf` (pages scanned: 5, header reports: None, incomplete: False)
- Join to `nv-housing-props.json`: **no match** (new property or unmapped)

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 1 | NV-15-03001 | 48 | 1-101 | 1-316 |

## FLETCHER — Ethel Mae Fletcher Apts

- Operator entity: Community Development Programs Center of Nevada - Vegas't Decatur LLC dba Ethel Mae Fletcher Apts.
- Source: `FLETCHER BIN.pdf` (pages scanned: 6, header reports: 9, incomplete: True)
- Join to `nv-housing-props.json`: **no match** (new property or unmapped)
- Warnings:
  - ⚠ BIN MAPPING DISPUTED / LOW CONFIDENCE (adversarial re-read 2026-05-29): the handwritten NV-14-04xxx margin annotations sit at the scan's resolution limit. Three reads disagree by a one-building shift -- primary extraction (bldg8=NV-14-04003, bldg10=NV-14-04005, bldg7/bldg9=null), adversarial verifier (bldg7=04003, bldg9=04005), and a source re-crop where the only legible annotation aligns with bldg8's unit rows (8-119/8-120). The bldg-1/2 BINs may also read NV-15-03001/03002 rather than the recorded NV-15-02001/02002. Values here are the primary extraction, retained per do-not-invent; treat fletcher's building->BIN mapping as PROVISIONAL pending GPMG's authoritative clean BIN list (docs/bins-verification-gaps-request.md).
  - ⚠ PDF has 6 pages but header reports 9; additional buildings/units may be missing — request a full scan.
  - ⚠ Header reports 'Page 1 of 9' but only 6 scanned pages (12 halves) are present on disk; pages 7-9 are missing. pagesReportedByHeader=9 set accordingly; no units/BINs fabricated for the missing pages.
  - ⚠ Building 4 is absent from this scan (BIN sequence skips from NV-15-02003 building-3 to NV-14-04001 building-5); consistent with brief note that buildings 4 and 6 may be absent. Building 6 IS present here (NV-14-04002, units 6-107..6-112).
  - ⚠ HAZARD CHECK PASSED: units 6-107 through 6-112 are correctly assigned to building 6 (leading prefix '6-'), NOT merged into building 5. Building 5 = 5-102..5-106 only.
  - ⚠ Unit 10-136 IS present (building 10), confirmed on page-06-a.
  - ⚠ Margin BIN annotations are handwritten; reads NV-14-04003 (bldg 8) and NV-14-04005/04007 (bldgs 10/11) are confident but the intermediate handwritten value near the bldg-10 boundary (possibly NV-14-04006) was not clearly attributable to a distinct building with its own unit block in this scan and was not invented.
  - ⚠ Buildings 7 and 9 have visible unit blocks but no clearly legible margin BIN adjacent to their first unit in this scan; bin set to null per do-not-invent rule.
  - ⚠ No printed Totals row was legible on the scanned page-halves to cross-check unit counts against; could not perform totals reconciliation. Total units transcribed: 65 across 10 building blocks.
  - ⚠ one or more buildings have no BIN extracted

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 1 | NV-15-02001 | 6 | 1-101 | 1-106 |
| 2 | NV-15-02002 | 11 | 2-107 | 2-117 |
| 3 | NV-15-02003 | 7 | 3-211 | 3-217 |
| 5 | NV-14-04001 | 5 | 5-102 | 5-106 |
| 6 | NV-14-04002 | 6 | 6-107 | 6-112 |
| 7 | **missing** | 6 | 7-113 | 7-118 |
| 8 | NV-14-04003 | 4 | 8-119 | 8-122 |
| 9 | **missing** | 7 | 9-123 | 9-129 |
| 10 | NV-14-04005 | 7 | 10-130 | 10-136 |
| 11 | NV-14-04007 | 6 | 11-137 | 11-142 |

## JUAN — Juan Garcia Apts

- Operator entity: Ernie Cragin LP dba Juan Garcia Apts
- Source: `JUAN BIN.pdf` (pages scanned: 5, header reports: 5, incomplete: False)
- Join to `nv-housing-props.json`: `Juan Garcia Aka Ernie Cragin`
- Warnings:
  - ⚠ HAZARD CONFIRMED — Building 2 margin BIN is handwritten as 'NV-00-0002' (4-digit suffix) on page-01-a, whereas all sibling buildings (3-7) use the 5-digit 'NV-00-0000N' family. Most likely a transcription/scan artifact missing a leading zero; normalized to 'NV-00-00002' for consistency. Flagging ambiguity: actual ink reads four digits ('0002').
  - ⚠ Building 1 is absent — report starts at Building 2 (first margin BIN on page-01-a). No NV-00-00001 BIN or 1-xxx units appear anywhere in the 5 pages.
  - ⚠ Pages on disk (5) match header count 'Page X of 5'.
  - ⚠ Unit numbering is split across two stacks per building (a 1xx/100-level group and a 2xx/200-level group), e.g. bldg 4 has 4-108..4-112 then 4-209..4-212; this is how the rotated table presents them, not a transcription duplication.
  - ⚠ Totals row not present as a distinct labeled summary line on these scans; could not cross-check against a property Totals figure. Total units extracted across 6 buildings = 47.

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 2 | NV-00-00002 | 8 | 2-101 | 2-204 |
| 3 | NV-00-00003 | 4 | 3-105 | 3-108 |
| 4 | NV-00-00004 | 9 | 4-108 | 4-212 |
| 5 | NV-00-00005 | 12 | 5-113 | 5-218 |
| 6 | NV-00-00006 | 8 | 6-119 | 6-222 |
| 7 | NV-00-00007 | 6 | 7-123 | 7-224 |

## LOUISE-SHELL — Louise Shell Senior Apts (dba Louise Shell Senior Apts; aka Louise Shell / Harmony Park Senior Apts)

- Operator entity: Community Development Programs Center of Nevada - LS/HP LP
- Source: `LOUISE SHELL BIN.pdf` (pages scanned: 10, header reports: 13, incomplete: True)
- Join to `nv-housing-props.json`: `Louise Shell/Harmony Park Apts`
- Warnings:
  - ⚠ PDF has 10 pages but header reports 13; additional buildings/units may be missing — request a full scan.
  - ⚠ BIN SERIAL SHIFT (recorded as seen, NOT corrected): buildings 1-3 carry the NV-01-0000N family (NV-01-00001 / NV-01-00002 / NV-01-00003) and are all '1 Bedroom' floor plans. Buildings 4-6 carry a RESTARTED NV-01-1000N family (NV-01-10001 / NV-01-10002 / NV-01-10003) and are all '2 Bedroom' floor plans. The serial does NOT continue 00004/00005/00006; it resets to 10001 at the 1BR->2BR floor-plan change. This matches the known property note that the serial shifts mid-property correlating with a floor-plan change. The 2BR family's BIN serials are therefore 1/2/3, not 4/5/6 - this is what is handwritten on the document.
  - ⚠ BUILDING 2 UNIT-NUMBER GAP CONFIRMED and flagged: building 2 units run 2-115..2-142 (first floor, 1xx series) then jump to 2-221..2-235 (second floor, 2xx series) - two floors. NO new handwritten margin BIN appears across the 2-142 -> 2-221 transition (verified on the page holding that boundary). Per rules, building 2 is kept as ONE building (NV-01-00002) spanning both floors.
  - ⚠ Building 3 first on-disk unit is 3-143 (the NV-01-00003 margin BIN appears at this row). Units 3-131..3-142, if they were ever assigned, are not present on disk; building 3's lower units may be incomplete, but the transcribed rows 3-143..3-156 are continuous and verified.
  - ⚠ PAGE-COUNT NOTE: the report footer reads 'Page N of 13' (e.g. page-09-b shows 'Page 9 of 13', page-10-b shows 'Page 10 of 13'), but only 10 pages (page-01..page-10, 20 halves) are present on disk. pagesReportedByHeader is therefore 13 while 10 pages were supplied. Despite the footer's '13', the BldgUnit sequence transcribed across the 10 on-disk pages is CONTINUOUS and self-consistent for all 6 buildings (1-101 through 6-184) with no internal breaks except the intentional building-2 two-floor gap above; the trailing pages 11-13 most likely hold only the report's grand-total / summary rows, not additional buildings. No buildings or units were fabricated for the missing pages.
  - ⚠ TOTALS CROSS-CHECK could NOT be completed: the rent-roll's grand-Totals row sits on the final page (13), which is not among the 10 supplied pages. The transcribed unit total is 112 (14 + 43 + 14 + 21 + 10 + 10). This figure is internally consistent but was not reconciled against an on-document Totals line. Re-scan pages 11-13 to confirm the count.
  - ⚠ READ-RELIABILITY CAVEAT: the image-read path intermittently returned stale/cached renders when many derived crops were read in rapid succession, producing inconsistent windows of the same page. Final unit lists were locked by reading byte-distinct single-page copies one at a time (verified via md5 that all 10 top-halves are distinct files) plus rotated/enlarged left-margin BIN crops for each handwritten BIN. Every BIN above was visually confirmed on its boundary page; every unit above appeared in a stable single-page read. Where a render was inconsistent, the value was excluded rather than guessed.
  - ⚠ Handwritten margin BINs read at building boundaries: NV-01-00001 (bldg 1, page 1, row 1-101), NV-01-00002 (bldg 2, page 2, row 2-115), NV-01-00003 (bldg 3, page 6, row 3-143), NV-01-10001 (bldg 4, page 7, row 4-145), NV-01-10002 (bldg 5, page 9, row 5-165), NV-01-10003 (bldg 6, page 10, row 6-175).

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 1 | NV-01-00001 | 14 | 1-101 | 1-114 |
| 2 | NV-01-00002 | 43 | 2-115 | 2-235 |
| 3 | NV-01-00003 | 14 | 3-143 | 3-156 |
| 4 | NV-01-10001 | 21 | 4-145 | 4-165 |
| 5 | NV-01-10002 | 10 | 5-165 | 5-174 |
| 6 | NV-01-10003 | 10 | 6-175 | 6-184 |

## MACK — (name not extracted)

- Operator entity: Community Development Programs Center of Nevada - Mixed Income, LLC dba Dr. Luther Mack Jr. Sr. Apts.
- Source: `MACK BIN.pdf` (pages scanned: 7, header reports: None, incomplete: False)
- Join to `nv-housing-props.json`: **no match** (new property or unmapped)

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 1 | NV-12-03001 | 47 | 1-101 | 1-316 |

## MEACHAM — Dr. Paul Meacham Sr. Apartments

- Operator entity: Community Development Programs Center of Nevada - Mixed Income 2 LLC
- Source: `MEACHAM BIN.pdf` (pages scanned: 8, header reports: 10, incomplete: True)
- Join to `nv-housing-props.json`: `Dr. Paul Meacham`
- Warnings:
  - ⚠ PDF has 8 pages but header reports 10; additional buildings/units may be missing — request a full scan.
  - ⚠ Header reads 'Page X of 10' but only 8 pages (16 halves) are present on disk (pages 1-8). Pages 9-10 are missing. All 8 present pages belong to the same Unit Scheduled Transactions report for the same single building; pages 1-7 list the unit rows, page 8 is the Totals page. No new BldgUnit IDs or building codes appear on later pages.
  - ⚠ Single building confirmed by handwritten red note 'Property Has One Building' across pages 1-2; one BIN (NV-13-03001) handwritten in red margin on pages 1, 2, and 3 ('BIN = NV-13-03001').
  - ⚠ 57 unique units extracted: floors 101-119, 201-219, 301-319 (3 floors x 19). Last unit visible is 13-03001-319 on page 8 just above the Totals row. Totals row present on page 8 (rent total 37,353.00) confirms end of unit list.
  - ⚠ Units include both LIHTC (1x1, 2x2) and market-rate ('1 Bedroom Market' / 1x1MK, '2 Bedroom Market' / 2x2MK) types; all 57 included regardless of type per instructions.
  - ⚠ Operator entity transcribed from header: 'Community Development Programs Center of Nevada - Mixed Income 2 LLC dba Dr. Paul Meacham Sr. Apts'.

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 13-03001 | NV-13-03001 | 57 | 13-03001-101 | 13-03001-319 |

## OCALLAGHAN — Governor Mike O'Callaghan Legacy Apartments

- Operator entity: Community Development Programs Center of Nevada - 1501 LLC
- Source: `OCALLAGHAN BIN.pdf` (pages scanned: 4, header reports: 7, incomplete: True)
- Join to `nv-housing-props.json`: **no match** (new property or unmapped)
- Warnings:
  - ⚠ PDF has 4 pages but header reports 7; additional buildings/units may be missing — request a full scan.
  - ⚠ INCOMPLETE SCAN: page headers read 'Page 1 of 7', 'Page 2 of 7', 'Page 3 of 7', 'Page 4 of 7' (one distinct page per scanned page, confirmed). The document is 7 pages but only pages 1-4 were scanned/provided. Buildings/pages 5-7 are MISSING; additional buildings (e.g. bldg 5+) likely exist and are not captured here.
  - ⚠ Only building 1 carries a margin BIN annotation: NV-22-05001 (handwritten in the right margin of page-01-b, read directly from the image). Buildings 2, 3, 4 were checked on page-02-b / page-03-b / page-04-b and have NO visible BIN annotation -> set to null. NOT guessed as 05002/05003/05004 despite the obvious sequential pattern, per the honest-extraction rule.
  - ⚠ All 40 units and the single BIN were confirmed by DIRECT VISUAL READ of all 8 page-halves (no inference): page-01 bldg1 units 101-110, page-02 bldg2 units 201-210, page-03 bldg3 units 301-310, page-04 bldg4 units 401-410. Building<->page mapping = BldgUnit hundreds digit. Each building has exactly 10 units (x01-x10).
  - ⚠ Floor Plan Codes present (1x1a, 1x1b, 2x1MK) and SQFT (650 / 850); these are unit-mix details not requested. No 'Totals' row was visible within the scanned pages to cross-check the 40-unit count (totals likely fall on a later, unscanned page).
  - ⚠ Operator/owner entity read from the page header on every page: 'Community Development Programs Center of Nevada - 1501 LLC dba Governor Mike O'Callaghan Legacy Apts.' Report 'As of 05/27/2026'. BIN family NV-22-* confirms 2022 LIHTC vintage.
  - ⚠ macOS Vision OCR was unavailable (swiftc failed with a CommandLineTools 'SwiftBridging' module-redefinition error); all extraction was done by direct visual reading of the scanned PNGs, including 90-degree rotation + JPEG re-export to read the landscape table upright.
  - ⚠ one or more buildings have no BIN extracted

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 1 | NV-22-05001 | 10 | 1-101 | 1-110 |
| 2 | **missing** | 10 | 2-201 | 2-210 |
| 3 | **missing** | 10 | 3-301 | 3-310 |
| 4 | **missing** | 10 | 4-401 | 4-410 |

## OWENS — Owens Senior Apartments

- Operator entity: Community Development Programs Center of Nevada - Owens 2, LP dba Owens Senior Apartments
- Source: `OWENS BIN.pdf` (pages scanned: 8, header reports: 10, incomplete: True)
- Join to `nv-housing-props.json`: `Owens Senior`
- Warnings:
  - ⚠ PDF has 8 pages but header reports 10; additional buildings/units may be missing — request a full scan.
  - ⚠ All 6 BINs CONFIRMED by direct visual read of handwritten margin annotations: NV-99-13001 (p1), NV-99-13002 (p2), NV-99-13003 (p3), NV-99-13004 (p4, above building-4 rows), NV-99-13005 (p5, above building-5 rows), NV-99-13006 (p7, above building-6 rows). All 6 expected buildings present.
  - ⚠ Scans are landscape tables stored rotated 90deg; halves had to be rotated upright (sips -r -90) to be legible. Harness image-render + bash channels degraded repeatedly under heavy machine load (load avg ~6-9, multiple parallel sessions); many reads required 20-120s retries and several halves could only be read once.
  - ⚠ TOTALS CROSS-CHECK PASSED: page-08 Totals row reads 47,270.00 across Market Rent / Effective Rent / Market+Addl columns, matching the prior-confirmed 58x$633 + 14x$754 = $47,270. Rent tiers consistent throughout: 1x1 / 1-Bedroom / 600sqft = $633; 2x1 / 2-Bedroom / 762sqft = $754.
  - ⚠ BUILDING 5 has only 8 units recorded: 5-130,131,132,133 (floor 1) + 5-230,231,232,233 (floor 2), all directly read on page-06. No page in the document set shows 5-134+/5-234+, so building 5 is recorded as 8 units. NOTE: this is fewer than the 12-unit pattern of buildings 2/3/4/6; the building-5 continuation may live on one of the 2 missing document pages (see page-count discrepancy below). Per RULE 3 no extra units were invented.
  - ⚠ DUPLICATE-PAGE ANOMALY in the scan set: file page-04 and file page-05 BOTH show building 4 (NV-99-13004 margin + units 4-121..126, 4-221..226) but carry DIFFERENT printed footers — page-04 footer = 'Page 4 of 10', page-05 footer = 'Page 5 of 10'. The two files have different md5 hashes (distinct scans), yet identical unit content. So one document page appears duplicated, OR building-4 legitimately spans two document pages. Building 4's units were de-duplicated to a single 12-unit list. This anomaly likely accounts for part of the 8-files-vs-10-header-pages gap and means the genuine building-5 continuation page may simply be absent from the scan set.
  - ⚠ PAGE-COUNT DISCREPANCY: header says 'Page 1 of 10' (10 document pages) but only 8 physical page files (16 halves) exist on disk at /tmp/bins-work/owens/. Confirmed footers: page-01=1of10, page-02=2of10, page-03=3of10, page-04=4of10, page-05=5of10, page-06=6of10, page-08=8of10 (page-07 footer not legibly captured but content = building 6). pagesReportedByHeader=10 per header. 2 document pages (likely 9 and 10, or a building-5 continuation) are not present on disk.
  - ⚠ Counts as recorded: 6 buildings, 72 units total (16 + 12 + 12 + 12 + 8 + 12). Building 1 has 16 units (1-101..108 + 1-201..208) — confirmed outlier, read directly across p1+p2. Buildings 2,3,4,6 have 12 each (6 per floor). Building 5 has only 8 read.
  - ⚠ RE-RUN RECOMMENDED on a fresh low-load machine to locate any missing document pages (9/10) and confirm whether building 5 has additional units. All 6 BINs, the operator entity, and the financial Totals ($47,270) are already fully verified by direct read.

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 1 | NV-99-13001 | 16 | 1-101 | 1-208 |
| 2 | NV-99-13002 | 12 | 2-109 | 2-214 |
| 3 | NV-99-13003 | 12 | 3-115 | 3-220 |
| 4 | NV-99-13004 | 12 | 4-121 | 4-226 |
| 5 | NV-99-13005 | 8 | 5-130 | 5-233 |
| 6 | NV-99-13006 | 12 | 6-127 | 6-236 |

## REID — (name not extracted)

- Operator entity: Community Development Programs Center of Nevada - 11th Street, LP dba Senator Harry Reid Senior Apts.
- Source: `REID BIN.pdf` (pages scanned: 10, header reports: None, incomplete: False)
- Join to `nv-housing-props.json`: `Sen. Harry Reid Senior Apts Aka 11Th St`

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 1 | NV-01-00011 | 99 | 1-101 | 1-339 |

## SMITH-WILLIAMS — Smith Williams Senior Apts.

- Operator entity: Smith Williams, LLC
- Source: `SMITH WILLIAMS BIN.pdf` (pages scanned: 11, header reports: 13, incomplete: True)
- Join to `nv-housing-props.json`: `Smith Williams Apts`
- Warnings:
  - ⚠ PDF has 11 pages but header reports 13; additional buildings/units may be missing — request a full scan.
  - ⚠ Header reports 'Page 1 of 13' but only 11 physical pages (22 halves) are present on disk; pagesReportedByHeader=13 set accordingly. Pages 12-13 not provided.
  - ⚠ All 3 expected BINs found, each handwritten in the left margin at the first unit of its building: NV-09-01001 @ unit 1101 (p01), NV-09-01002 @ unit 2109 (p04), NV-09-01003 @ unit 3116 (p06).
  - ⚠ Unit numbering is property-wide (not per-building reset) and skips numbers, consistent with the known structure. Building 2 floor-2 sequence reads 2206 then 2209-2215 (2207-2208 not present in the roll); transcribed exactly as printed, no units invented.
  - ⚠ Building 2 floor-3 starts at 2310 and runs 2310-2315 (6 units); building 3 starts at 3116.
  - ⚠ Totals row on final page (p11-b) = 54,132.00, which is a summed rent/dollar amount, NOT a unit count. 79 unit rows transcribed across the 3 buildings.

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 1 | NV-09-01001 | 23 | 1101 | 1308 |
| 2 | NV-09-01002 | 21 | 2109 | 2315 |
| 3 | NV-09-01003 | 35 | 3116 | 3327 |

## SRB — Senator Richard Bryan Senior Apartments

- Operator entity: Community Development Programs Center of Nevada - SRB LP
- Source: `SRB BIN.pdf` (pages scanned: 24, header reports: 27, incomplete: True)
- Join to `nv-housing-props.json`: **no match** (new property or unmapped)
- Warnings:
  - ⚠ BIN FORMAT CORRECTED (adversarial re-read 2026-05-29): phase-1 buildings 1-15 carry STANDARD BINs NV-07-19001..NV-07-19015 (serial = 19000 + building#). The earlier extraction misread the continuous typed margin string 'NV-0719001' as a 4-segment 'NV-07-19-0001' (dropping it below 5 trailing digits). Phase-2 buildings 16-30 = NV-05-06001..NV-05-06015. Building number maps 1:1 to serial within each phase; all 30 BINs now satisfy NV-YY-NNNNN.
  - ⚠ PDF has 24 pages but header reports 27; additional buildings/units may be missing — request a full scan.
  - ⚠ BUILDING 14 UNIT GAP CONFIRMED: building 14 jumps 14-1106 -> 14-1108 with no 14-1107 row present on either half of the page. The gap is real in the source rent-roll, not a scan/crop artifact. Verified on page 14.
  - ⚠ 26/27 BOUNDARY (prior-read hazard) RESOLVED: building 26 anchors to BIN NV-05-06011 and building 27 anchors to NV-05-06012. They sit on consecutive pages; each BIN header cleanly precedes its own building's unit block. No single page carries two ambiguous BINs for the 26/27 pair - the sequence is unambiguous (06011=bldg26, 06012=bldg27).
  - ⚠ MISSING PAGES: header reads 'Page X of 27' but only 24 physical pages (page-01..page-24, 48 halves) are present on disk. Pages 25, 26, 27 are NOT present. Building 30 (NV-05-06015) may have additional units beyond those captured, and any building 31+ (if it exists) is entirely absent. Building count of 30 is the maximum supportable by the observed BIN sequence (NV-05-06015 = 15th phase-2 building).
  - ⚠ UNIT-CODE FORMAT is NN-NNNN (zero-padded 2-digit building prefix + 4-digit unit), e.g. 05-1049, 23-1161. Full bldg-prefixed unit string retained for every unit because unit numbers collide across buildings (e.g. 13-1101 vs 23-1101; 20-1175/24-1175/25-1177 share the 117x band). Only the building prefix disambiguates.
  - ⚠ UNIT-LIST FIDELITY CAVEAT: this is the LARGEST property (30 buildings, ~185 units) on dense rotated landscape scans. BIN-to-building anchoring is high-confidence (typed section headers, clean sequence). Individual unit-NUMBER cells within each block are lower-confidence - some unit serials may be off by a digit or a row may be missed/duplicated due to scan density. The unit COUNT per building and the BIN mapping are the reliable outputs; exact unit serials should be re-verified against a clean source before any compliance filing.
  - ⚠ Buildings 16-20 ARE present and observed in this read (pages 16-20, BINs NV-05-06001..06005) - this corrects an earlier-read assumption that 16-20 were missing. The actually-missing content is pages 25-27 (tail of bldg 30 / any bldg 31+).

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 1 | NV-07-19001 | 6 | 01-1001 | 01-1006 |
| 2 | NV-07-19002 | 8 | 02-1017 | 02-1024 |
| 3 | NV-07-19003 | 4 | 03-1037 | 03-1040 |
| 4 | NV-07-19004 | 8 | 04-1041 | 04-1048 |
| 5 | NV-07-19005 | 8 | 05-1049 | 05-1056 |
| 6 | NV-07-19006 | 8 | 06-1057 | 06-1064 |
| 7 | NV-07-19007 | 8 | 07-1065 | 07-1072 |
| 8 | NV-07-19008 | 8 | 08-1073 | 08-1080 |
| 9 | NV-07-19009 | 14 | 09-1081 | 09-1094 |
| 10 | NV-07-19010 | 8 | 10-1073 | 10-1080 |
| 11 | NV-07-19011 | 8 | 11-1025 | 11-1032 |
| 12 | NV-07-19012 | 8 | 12-1009 | 12-1016 |
| 13 | NV-07-19013 | 3 | 13-1101 | 13-1103 |
| 14 | NV-07-19014 | 7 | 14-1105 | 14-1112 |
| 15 | NV-07-19015 | 8 | 15-1113 | 15-1120 |
| 16 | NV-05-06001 | 8 | 16-1121 | 16-1128 |
| 17 | NV-05-06002 | 8 | 17-1209 | 17-1216 |
| 18 | NV-05-06003 | 5 | 18-1196 | 18-1200 |
| 19 | NV-05-06004 | 7 | 19-1128 | 19-1134 |
| 20 | NV-05-06005 | 10 | 20-1175 | 20-1184 |
| 21 | NV-05-06006 | 9 | 21-1146 | 21-1154 |
| 22 | NV-05-06007 | 6 | 22-1155 | 22-1160 |
| 23 | NV-05-06008 | 14 | 23-1161 | 23-1174 |
| 24 | NV-05-06009 | 4 | 24-1175 | 24-1178 |
| 25 | NV-05-06010 | 8 | 25-1177 | 25-1184 |
| 26 | NV-05-06011 | 6 | 26-1185 | 26-1190 |
| 27 | NV-05-06012 | 6 | 27-1203 | 27-1208 |
| 28 | NV-05-06013 | 4 | 28-1217 | 28-1220 |
| 29 | NV-05-06014 | 10 | 29-1221 | 29-1230 |
| 30 | NV-05-06015 | 10 | 30-1231 | 30-1240 |

## YALE — Yale (Yale Keyes Senior Apts)

- Operator entity: Yale Keyes LP dba Yale Keyes Senior Apts.
- Source: `YALE BIN.pdf` (pages scanned: 9, header reports: 11, incomplete: True)
- Join to `nv-housing-props.json`: `Yale/Keyes Senior Apts`
- Warnings:
  - ⚠ PDF has 9 pages but header reports 11; additional buildings/units may be missing — request a full scan.
  - ⚠ Header reads 'Page X of 11' but only 9 physical pages (18 halves) on disk; page-09-b ends with a 'Totals:' row and a grand total ($52,044.00), so the unit roll is complete. The extra header pages (10-11) are likely trailing summary/legend pages not included in this scan and contain no additional units.
  - ⚠ BIN NV-01-00004 read from the page-01-a header ('BIN # NV-01-00004'); no handwritten margin BIN observed.
  - ⚠ Single building (buildingCode '1'), 70 units: 35 on floor 1 (1-101..1-135) and 35 on floor 2 (1-201..1-235). Most units are 1x1/1Bedroom (700 SQFT); a handful are 2x1/2Bedroom (800 SQFT), all CA-RENT.

| Building | BIN | Units | First | Last |
|---:|---|---:|---|---|
| 1 | NV-01-00004 | 70 | 1-101 | 1-235 |
