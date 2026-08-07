# แบบลงนามรับรองทางคลินิก ระยะที่ 0 — ระบบคัดกรองความเสี่ยงมารดาระหว่างรอคลอด

# Phase 0 Clinical Sign-off — Maternal Labor-Triage Screening

> **สถานะปัจจุบัน / Current status:** `PROVISIONAL_UNAPPROVED` (rule-set `0.1.0-provisional`)
> **ผู้รับรอง / Approved by:** _(ยังไม่ลงนาม / not yet signed)_ · **วันที่ / Date:** _______________
> เอกสารนี้เป็นเครื่องมือเดียวที่ใช้ปิดระยะที่ 0 (Phase 0 exit gate) ตาม
> `docs/maternal-screen-plan.md` §11 และ Acceptance Criteria #24.
> ทุกค่าตัวเลข/เกณฑ์ในเอกสารนี้ถอดความตรงจากไฟล์ต้นทาง (fixtures) ไม่มีการปัดหรือปรับปรุงใด ๆ

แหล่งข้อมูลต้นทาง (source of truth) ของเอกสารนี้:

- `docs/clinical/maternal-screen-rules-v1.yaml` — กฎ local-tier 19 ข้อ (preeclampsia + antepartum hemorrhage)
- `docs/clinical/maternal-screen-acuity-v1.yaml` — กฎ emergency acuity 7 ข้อ + อัลกอริทึม STABLE/UNKNOWN
- `docs/clinical/maternal-screen-evidence-register.md` — ทะเบียนหลักฐานอ้างอิง
- `docs/maternal-screen-plan.md` — เอกสารออกแบบ (design doc) §2.5, §7.5, §11, §17.2, §20
- `tests/fixtures/maternal-screen-clinical-cases.json` — เคสทดสอบ (oracle) 66 เคส (รวม 2 เคสชื่อ "P0-GAP")

---

## 1. บทนำ (Purpose)

### 1.1 ระบบนี้ทำอะไร (What this feature is)

ระบบคัดกรองความเสี่ยงมารดาระหว่างรอคลอด (labor-triage screening) จำแนกผลออกเป็น **สามแกนที่อิสระต่อกัน**
(ต้องไม่รวมเป็น enum เดียว — GC3):

1. **Local tier — ภาวะครรภ์เป็นพิษ (preeclampsia)**: จัดระดับ `LOCAL_MILD` / `LOCAL_MODERATE` / `LOCAL_SEVERE`
   ตามตารางใน PDF ท้องถิ่น (อาการ / ความดันโลหิต / ผลแล็บ).
2. **Local tier — สงสัยตกเลือดก่อนคลอด (suspected antepartum hemorrhage, APH)**: รูปแบบที่สงสัย
   abruptio placentae, placenta previa, uterine rupture, vasa previa — เป็น "รูปแบบที่สงสัย" (suspected patterns) เท่านั้น.
3. **Emergency acuity — ระดับความฉุกเฉิน**: `EMERGENCY` / `URGENT` / `STABLE` / `UNKNOWN`
   คำนวณ **อิสระ** จากสาเหตุที่สงสัยและจากปริมาณเลือดที่มองเห็น (spec §7.2 step 3, §7.4.3).

### 1.2 การลงนามนี้หมายถึงอะไร (What signing does)

การลงนามคือการอนุมัติ **ตารางการตัดสินใจสองชุด** (local-tier table + acuity table) และเคสทดสอบที่คาดหวัง
ให้กลายเป็น **ชุดกฎที่รับรองแล้ว (approved rule set) v1.0.0**. จนกว่าจะลงนาม ทุกกฎทำงานแบบ
**shadow-labeled** ภายใต้ rule-set `0.1.0-provisional` และ **ไม่มีกฎใดขับเคลื่อน production alert ได้** (spec §11 exit gate).

### 1.3 การลงนามนี้ **ไม่ได้** หมายถึงอะไร (What signing does NOT do)

- **ไม่ใช่การวินิจฉัย (no diagnosis).** ผลทั้งหมดเป็น "รูปแบบที่สงสัย" (suspected), ไม่เคยระบุว่า "diagnosed".
- **ไม่ใช่คำแนะนำการรักษา (not treatment guidance).** เป็นเพียงตัวช่วยคัดกรอง (screening support) เท่านั้น.
- **ไม่อนุญาต/ไม่แนะนำการตรวจภายในทางช่องคลอด (digital examination)** — ไม่มีสถานะระบบใดสั่งการตรวจภายใน
  การตัดสินใจตรวจยังอยู่ในดุลยพินิจของแพทย์ตาม local protocol (AC #21, decision 7.5-18).

### 1.4 สถานะการติดตั้งจริงในปัจจุบัน (Current deployment posture — honest statement)

ตาม design doc §17.1 มี feature flag แยกกันสี่ตัว. สถานะจริงตอนนี้:

- **UI แบบอ่านอย่างเดียว (read-only shadow UI): เปิดโดยค่าเริ่มต้น (defaults on)** พร้อมป้าย shadow.
- **การรับ/บันทึกข้อมูล (data capture / ingest): ปิด** จนกว่าจะเปิดแยกต่างหาก.
- **การแจ้งเตือน (alerts / events): ปิด** จนกว่าจะเปิดแยกต่างหากหลังผ่านการยอมรับ (acceptance).

Shadow mode เป็นสถานะ default ของการ rollout จนกว่าจะบันทึกการยอมรับทางคลินิก (AC #17).

---

## 2. สิ่งที่ต้องได้รับจากโรงพยาบาล (Required from the hospital)

ตาม design doc §2.5 และ spec §11 Phase 0 task 6 — **ก่อนลงนามรับรอง** โรงพยาบาลต้องส่งมอบคู่มือต้นฉบับภาษาไทยฉบับสมบูรณ์
ที่ PDF ท้องถิ่นอ้างถึง โดยอ้างคำต่อคำเท่าที่ดึงข้อความได้:

> **"คู่มือการดูแลรักษาสตรีตั้งครรภ์ที่มีความเสี่ยงสูงฯ เขตสุขภาพที่ (ปรับปรุงครั้งที่ 3) หน้า 14–17"**

ข้อมูลที่ยัง **กู้คืนไม่ได้** จาก PDF ที่ให้มา และโรงพยาบาลต้องระบุให้ครบก่อนอนุมัติ:

- หมายเลข **เขตสุขภาพ** (health-region number)
- **หน่วยงานที่จัดทำ/เผยแพร่** (issuing organization)
- **วันที่/ปีของฉบับพิมพ์** (edition date)
- **ชื่อเต็ม** ของคู่มือ (complete title)

จนกว่าจะได้รับ, `LOCAL_PDF` ในทะเบียนหลักฐานหมายถึงเฉพาะเนื้อหาที่ดึงได้จาก `docs/maternal-screen.pdf` เท่านั้น
(evidence register "Outstanding evidence gap"; design doc §2.5).

---

## 3. ตารางการตัดสินใจ (Decision tables)

**คำสั่งลงนาม:** สำหรับแต่ละแถว โปรดเลือกหนึ่งช่อง: ☐ **อนุมัติตามนี้** (approve as-is) หรือ
☐ **แก้ไขเป็น** (amend to) พร้อมเขียนค่าที่แก้ไขในช่องว่าง. ทุกตัวเลือกปัจจุบันมีสถานะ `approved: false`.

> หมายเหตุการอ่านค่า operator: `>=` = มากกว่าหรือเท่ากับ, `>` = มากกว่า (เข้ม/strict), `<` = น้อยกว่า (เข้ม),
> `!=` = ไม่เท่ากับ, `in [...]` = เป็นค่าใดค่าหนึ่งในรายการ.

### 3.1 ครรภ์เป็นพิษ — ความดันโลหิต (Preeclampsia — blood-pressure tiers)

| Decision / Rule ID | คำถามทางคลินิก (Thai) | ค่าที่ระบบใช้อยู่ (provisional) | การตัดสิน |
| --- | --- | --- | --- |
| **7.5-3** · `PE-BP-MILD-140` | SBP ≥ 140 เพียงอย่างเดียวถือเป็น **mild** หรือไม่ เมื่อ DBP ปกติหรือขาดค่า? | `systolicBp >= 140` **หรือ** `diastolicBp >= 90` → `LOCAL_MILD` (SBP อย่างน้อย 140 หรือ DBP อย่างน้อย 90 = ระดับเบา) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-4** · `PE-BP-MODERATE-SBP-150` / `PE-BP-MODERATE-DBP-100` | ระดับ **moderate** คือ SBP ≥ 150 หรือ DBP ≥ 100 หรือไม่? | `systolicBp >= 150` → `LOCAL_MODERATE`; `diastolicBp >= 100` → `LOCAL_MODERATE` (SBP อย่างน้อย 150 หรือ DBP อย่างน้อย 100 = ระดับปานกลาง) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-5** · `PE-BP-SEVERE-SBP-160` / `PE-BP-SEVERE-DBP-110` | ระดับ **severe** คือ SBP ≥ 160 หรือ DBP ≥ 110 หรือไม่? | `systolicBp >= 160` → `LOCAL_SEVERE`; `diastolicBp >= 110` → `LOCAL_SEVERE` (SBP อย่างน้อย 160 หรือ DBP อย่างน้อย 110 = ระดับรุนแรง) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-9** _(ไม่มีกฎ)_ | ต้องยืนยันความดันด้วยการวัดซ้ำ และเว้นช่วงเวลากี่นาทีหรือไม่? | **ไม่มีการบังคับวัดซ้ำหรือเว้นช่วงเวลา** — ค่าเดียวที่เข้าเกณฑ์ก็ทำให้กฎ BP ทำงาน (ไม่หน่วงการ escalate; ACOG "สองครั้งห่างกัน ≥4 ชม." บันทึกเป็นหลักฐานสนับสนุนเท่านั้น) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-16** _(ไม่มีกฎ)_ | ช่วงเวลายืนยันความดันใดใช้กับบริบทคัดกรอง/วินิจฉัย/รักษาเร่งด่วน? | **ไม่ถูกจำลองใน v1** — ไม่มี interval gating ที่ใดใน fixture (ต่อเนื่องจาก 7.5-9); การเก็บ timestamp เป็นหน้าที่ persistence (Phase 2) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |

### 3.2 ครรภ์เป็นพิษ — อาการ (Preeclampsia — symptoms / clinical domain)

| Decision / Rule ID | คำถามทางคลินิก (Thai) | ค่าที่ระบบใช้อยู่ (provisional) | การตัดสิน |
| --- | --- | --- | --- |
| **7.5-1** · `PE-HEADACHE-IN-LOCAL-SEVERE-COLUMN` | อาการรุนแรงเพียงหนึ่งอย่างทำให้เป็น severe ได้เลยหรือไม่? | ใช่ — `headache == "SEVERE"` → `LOCAL_SEVERE` (แต่ละ domain เป็น anyOf อิสระ; ค่าที่สูงสุดข้าม domain ชนะ) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-1** · `PE-HEADACHE-MODERATE-TOLERABLE` | ปวดศีรษะเล็กน้อย/พอทนได้ จัดเป็น moderate หรือไม่? | `headache == "MILD"` → `LOCAL_MODERATE` (ตรงกับช่อง Clinical/Moderate ของ PDF "ปวดศีรษะเล็กน้อย/พอทนได้") | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-1** · `PE-BLURRED-VISION-IN-LOCAL-SEVERE-COLUMN` | ตามัวเพียงอย่างเดียวเป็น severe หรือไม่? | `blurredVision == true` → `LOCAL_SEVERE` | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-1** · `PE-EPIGASTRIC-PAIN-IN-LOCAL-SEVERE-COLUMN` | จุกแน่น/ปวดใต้ลิ้นปี่เพียงอย่างเดียวเป็น severe หรือไม่? | `epigastricPain == true` → `LOCAL_SEVERE` | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-1** · `PE-PULMONARY-EDEMA-IN-LOCAL-SEVERE-COLUMN` | ภาวะปอดบวมน้ำเพียงอย่างเดียวเป็น severe หรือไม่? | `pulmonaryEdema == true` → `LOCAL_SEVERE` | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-2** _(ไม่มีกฎ gating)_ | ต้องวินิจฉัย PIH และ GA ≥ 20 สัปดาห์ก่อน ทุกระดับครรภ์เป็นพิษหรือไม่? | **ไม่** — `piHDiagnosed` และ `gaWeeks` เก็บเป็น input แต่ไม่ใช่เงื่อนไขปิดกั้นกฎ BP/lab/อาการ (ไม่กดทับผลรุนแรงจริง) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |

### 3.3 ครรภ์เป็นพิษ — โปรตีนในปัสสาวะ (Preeclampsia — proteinuria)

| Decision / Rule ID | คำถามทางคลินิก (Thai) | ค่าที่ระบบใช้อยู่ (provisional) | การตัดสิน |
| --- | --- | --- | --- |
| **7.5-6** · `PE-PROT-MILD-1PLUS` | โปรตีน 1+ อยู่ระดับใด? | `proteinuriaGrade == "ONE_PLUS"` → `LOCAL_MILD` (1+ = แล็บระดับเบา) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-6** · `PE-PROT-SEVERE-2TO3PLUS` | โปรตีน 2+ อยู่ moderate, severe, หรือทั้งคู่ และค่าใดชนะ? | `proteinuriaGrade in ["TWO_PLUS","THREE_PLUS","FOUR_PLUS"]` → `LOCAL_SEVERE` (2+/3+ = รุนแรง, ค่าสูงชนะ; 4+ รวมไว้เกินเพดาน 3+ ของ PDF อย่างระมัดระวัง; ไม่มีกฎ moderate โปรตีนแยก เพราะช่วง 1–2+ ถูกดูดเข้าเบา(1+)/รุนแรง(2+) หมดแล้ว) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-17** _(ไม่มีกฎ)_ | วิธีวัดโปรตีนเชิงปริมาณใดเป็นที่นิยม และแสดงหลักฐาน dipstick อย่างเดียวอย่างไร? | โมเดลเฉพาะค่า dipstick `ProteinuriaGrade` (NEGATIVE/TRACE/ONE_PLUS..FOUR_PLUS/UNKNOWN); ไม่จำลอง PCR/ACR เป็น input แยกใน v1; การแสดง provenance เป็นเรื่อง UI (Phase 4) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |

### 3.4 ครรภ์เป็นพิษ — ผลแล็บ (Preeclampsia — laboratory, boundary-exact)

| Decision / Rule ID | คำถามทางคลินิก (Thai) | ค่าที่ระบบใช้อยู่ (provisional) | การตัดสิน |
| --- | --- | --- | --- |
| **7.5-7** · `PE-LAB-SEVERE-CREATININE-1_1` | Creatinine 1.1 ปกติ และเฉพาะค่า **มากกว่า** 1.1 เท่านั้นที่ severe ใช่หรือไม่? | `creatinineMgDl > 1.1` (เข้ม/strict) → `LOCAL_SEVERE`; **1.10 พอดี ไม่ severe** (NICE ≥1.0 เป็นหลักฐานบริบทเท่านั้น; creatinine doubling ไม่ถูกเข้ารหัสใน v1) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-8** · `PE-LAB-SEVERE-PLATELET-100K` | เกล็ดเลือด 100,000/µL พอดี ถือว่า **ไม่** severe ใช่หรือไม่? | `plateletPerUl < 100000` (เข้ม/strict) → `LOCAL_SEVERE`; **100,000 พอดี ไม่ severe** (NICE <150,000 เป็นหลักฐานบริบทเท่านั้น) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-15** _(ไม่มีกฎ)_ | โมเดลที่รับรองรวม liver dysfunction, oliguria, creatinine doubling, uteroplacental dysfunction หรือไม่? | **ไม่ใน v1** — `astIuL`, `altIuL`, `urineOutputMlPerHour`, `creatinineBaselineMgDl` เก็บใน input เพื่อใช้อนาคต แต่ไม่มีกฎ LOCAL_PDF_TIER รองรับ (PDF ไม่ได้ระบุ) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |

### 3.5 ตกเลือดก่อนคลอด — เกณฑ์อายุครรภ์ + รูปแบบที่สงสัย (APH — GA threshold + suspected patterns)

| Decision / Rule ID | คำถามทางคลินิก (Thai) | ค่าที่ระบบใช้อยู่ (provisional) | การตัดสิน |
| --- | --- | --- | --- |
| **7.5-13** · (นิยาม APH) | ระบบท้องถิ่นใช้นิยาม APH ที่ 24+0, 26+0 หรืออื่น? | **26+0 สัปดาห์** (`gaWeeks >= 26`) ตาม PDF ท้องถิ่น (RCOG 24+0 และ WHO 22 สัปดาห์ เป็นหลักฐานสนับสนุนเท่านั้น) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-12** · `APH-GA26-VAGINAL-BLEEDING` | จัดการเลือดออกทางช่องคลอดที่ GA < 26 สัปดาห์ และ GA ไม่ทราบ อย่างไร? | `gaWeeks >= 26` **และ** `vaginalBleeding == true` → `LOCAL_SEVERE`. ที่ GA < 26 หรือไม่ทราบ กฎนี้ไม่ทำงานและ **ไม่ลดระดับผลรวม** (เพิ่ม gaWeeks เข้า missingRequiredFields; กฎรูปแบบ APH ที่ไม่ผูก GA ยังทำงาน) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-11** · `APH-ABRUPTIO-PATTERN` (รกลอกตัวก่อนกำหนด) | หลักฐานขั้นต่ำในการติดป้าย "สงสัย abruptio placentae"? | `vaginalBleeding == true` **และ** ≥1 ใน (`abdominalOrBackPain` / `uterineTenderness` / `frequentContractions` / fetal distress: `fetalTracingPattern in [NON_REASSURING, SINUSOIDAL]` **หรือ** `fetalHeartRateBpm < 110` **หรือ** `> 160`); **หรือ** `concealedBleedingSuspected == true` และ ≥1 ใน (`abdominalOrBackPain` / `uterineTenderness` / `frequentContractions`) — ไม่ต้องมีเลือดออกให้เห็น (GC4) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-11** · `APH-PREVIA-PATTERN` (รกเกาะต่ำ) | หลักฐานขั้นต่ำ "สงสัย placenta previa"? | `vaginalBleeding == true` **และ** `abdominalOrBackPain != true` (เท็จหรือยังไม่ประเมิน) — "มักไม่ปวด"; ทำงานแม้ยังไม่ประเมินอาการปวด (ป้องกันการ under-flag; GC1); ไม่เคยระบุว่า diagnosed | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-11** · `APH-RUPTURE-UTERUS-PATTERN` (มดลูกแตก) | หลักฐานขั้นต่ำ "สงสัย uterine rupture"? | ≥1 ใน (`contractionDurationExceedsInterval` / `suprapubicTenderness` / `bandlsRing`) — **อิสระจาก** `vaginalBleeding` (เลือดออกอาจอยู่ในช่องท้องทั้งหมด) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-11** · `APH-VASA-PREVIA-PATTERN` (เส้นเลือดทารกเกาะต่ำ) | หลักฐานขั้นต่ำ "สงสัย vasa previa"? | `vaginalBleeding == true` **และ** `membranesRuptured == true` **และ** `fetalTracingPattern in [SINUSOIDAL, NON_REASSURING]` (SMFM Consult 37; รวม NON_REASSURING เพื่อกันการ under-flag) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-10** · (FHR band ใน APH-ABRUPTIO) | FHR 110 และ 160 พอดี ปกติหรือไม่? | ช่วงปกติ **110–160 bpm รวมปลายทั้งสอง** (inclusive); 109 และ 161 ผิดปกติ; FHR นอกช่วงนี้เป็นหลักฐาน "fetal distress" หนึ่งรูปแบบใน APH-ABRUPTIO; ค่า FHR ปกติไม่เคยลดระดับผลแกนอื่น (GC4) และไม่พิสูจน์ previa | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-18** _(ไม่มีกฎ)_ | หลักฐานใดถือว่า "placenta previa ถูก exclude แล้ว" ก่อนเปลี่ยน workflow การตรวจ? | **ยังไม่แก้ใน v1** — `placentaPreviaExcluded`, `placentaLocationSource` เก็บเป็น input แต่ไม่มีกฎใดใช้ flag นี้อนุญาต/เปิดใช้การตรวจภายใน (คงดุลยพินิจแพทย์) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-19** · (sinusoidal CTG capture) | ระบบเก็บ sinusoidal CTG เป็นข้อมูลโครงสร้าง หรือรับจากระบบ CTG แยก? | เก็บเป็นข้อมูลโครงสร้างผ่าน enum `fetalTracingPattern` (REASSURING/NON_REASSURING/SINUSOIDAL/UNKNOWN) ใช้โดย APH-VASA-PREVIA, สาขา fetal-distress ของ APH-ABRUPTIO และกฎ acuity | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |

### 3.6 การจัดลำดับความรุนแรง (Tier ranking — provisional)

| Decision / ref | คำถามทางคลินิก (Thai) | ค่าที่ระบบใช้อยู่ (provisional) | การตัดสิน |
| --- | --- | --- | --- |
| **T1-RANK** · `localTierRank` | เมื่อหลายกฎทำงานพร้อมกัน ระดับใดถือเป็นผลสุดท้าย? | ลำดับ: `NO_LOCAL_MATCH=0 < LOCAL_MILD=1 < LOCAL_MODERATE=2 < LOCAL_SEVERE=3` — เลือกระดับสูงสุดที่ match แต่ยังคืนทุก match (spec §7.2 step 7) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |

### 3.7 ระดับความฉุกเฉิน (Emergency acuity thresholds — independent axis)

กฎ acuity ทั้งหมดอ้าง decision **7.5-14** (ยกเว้นสองข้อ SpO2/pulse ที่อ้าง **T1-OXYGEN-PULSE-SOURCING**).
ลำดับความรุนแรง `emergencyAcuityRank`: `UNKNOWN=0 < STABLE=1 < URGENT=2 < EMERGENCY=3` (เลือกค่าสูงสุดที่ match).

| Decision / Rule ID | คำถามทางคลินิก (Thai) | ค่าที่ระบบใช้อยู่ (provisional) | การตัดสิน |
| --- | --- | --- | --- |
| **7.5-14** · `EA-SHOCK-SIGNS-EMERGENCY` | มีสัญญาณช็อก = ฉุกเฉินสูงสุดหรือไม่? | `shockSignsPresent == true` → `EMERGENCY` | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-14** · `EA-CONSCIOUSNESS-DEPRESSED-EMERGENCY` | ระดับความรู้สึกตัวใดถือเป็น EMERGENCY? | `consciousness in ["PAIN","UNRESPONSIVE"]` → `EMERGENCY` (AVPU ตอบสนองเฉพาะความเจ็บ หรือไม่ตอบสนอง; ยกทั้งสองเท่ากัน) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-14** · `EA-BLEEDING-HEAVY-EMERGENCY` | เลือดออกมาก = EMERGENCY หรือไม่? | `bleedingRate == "HEAVY"` → `EMERGENCY` (อิสระจากสาเหตุและปริมาณเลือดที่เห็น; GC4) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-14** · `EA-FETAL-SINUSOIDAL-EMERGENCY` | คลื่นหัวใจทารก sinusoidal = EMERGENCY หรือไม่? | `fetalTracingPattern == "SINUSOIDAL"` → `EMERGENCY` (รูปแบบที่บ่งบอกอันตราย) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **T1-OXYGEN-PULSE-SOURCING** · `EA-OXYGEN-SAT-LOW-URGENT` | SpO2 ต่ำกว่าเท่าใดถือเป็น URGENT? | `oxygenSaturationPct < 95` → `URGENT` — **ตัวเลขนี้เป็นเกณฑ์ความปลอดภัยที่วิศวกรกำหนดเชิงระมัดระวัง ไม่ได้ดึงตัวเลขจาก guideline ใดโดยตรง; ต้องแทนด้วยเกณฑ์ที่แพทย์รับรองที่ Phase 0** | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **T1-OXYGEN-PULSE-SOURCING** · `EA-PULSE-HIGH-URGENT` | ชีพจรมารดาเกินเท่าใดถือเป็น URGENT? | `maternalPulseBpm > 120` → `URGENT` — **ตัวเลขนี้เป็นเกณฑ์ความปลอดภัยที่วิศวกรกำหนดเชิงระมัดระวัง; ต้องแทนด้วยเกณฑ์ที่แพทย์รับรองที่ Phase 0** | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-14** · `EA-FETAL-NON-REASSURING-URGENT` | คลื่นหัวใจทารก non-reassuring (ไม่ใช่ sinusoidal) = URGENT หรือไม่? | `fetalTracingPattern == "NON_REASSURING"` → `URGENT` (ต่ำกว่า SINUSOIDAL หนึ่งอันดับ) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |
| **7.5-14** · (การแบ่ง EMERGENCY/URGENT) | การแบ่งว่าอาการใดเป็น EMERGENCY vs URGENT ถูกต้องหรือไม่? | เป็น **การตัดสินเชิงออกแบบของทีม** (design doc ให้ชุด finding แต่ไม่ระบุการแบ่งแต่ละอันเป็น EMERGENCY/URGENT); ต้อง reconcile กับดุลยพินิจแพทย์ที่ลงนาม | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |

### 3.8 ชุดฟิลด์บังคับ (Mandatory-fields set)

| Decision / ref | คำถามทางคลินิก (Thai) | ค่าที่ระบบใช้อยู่ (provisional) | การตัดสิน |
| --- | --- | --- | --- |
| **T1-MANDATORY-FIELDS** | ฟิลด์ใดบ้างที่ **บังคับ** ต่อ `isComplete` / `missingRequiredFields`? | 11 ฟิลด์: `gaWeeks`, `gaDays`, `systolicBp`, `diastolicBp`, `proteinuriaGrade`, `headache`, `vaginalBleeding`, `fetalHeartRateBpm`, `maternalPulseBpm`, `consciousness`, `shockSignsPresent` (การขาดฟิลด์ใดทำให้ isComplete=false; เป็นการตัดสินเชิงออกแบบ Task 1 ต้อง reconcile กับ MANDATORY_SCREEN_FIELDS ในโค้ด) | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |

> **หมายเหตุ:** `bleedingRate`, `oxygenSaturationPct`, `fetalTracingPattern` **ไม่อยู่** ในชุดบังคับข้างต้นโดยตั้งใจ —
> ทั้งสามอยู่ในชุดแยกที่แคบกว่า (`stabilityDeterminationFields`) ใช้เฉพาะตัดสิน STABLE vs UNKNOWN เท่านั้น (ดู §3.9).

### 3.9 การตัดสิน STABLE vs UNKNOWN (STABLE/UNKNOWN determination algorithm)

| Decision / ref | คำถามทางคลินิก (Thai) | ค่าที่ระบบใช้อยู่ (provisional) | การตัดสิน |
| --- | --- | --- | --- |
| **T1-ACUITY-DETERMINATION** | แยก STABLE จาก UNKNOWN อย่างไรเมื่อไม่มีกฎ instability ทำงาน? | อัลกอริทึม: (1) ประเมินทุกกฎ acuity — ถ้ามีกฎทำงาน ใช้ค่า acuity สูงสุด; (2) มิฉะนั้น ถ้าฟิลด์ **ทั้งหกใน `stabilityDeterminationFields`** ถูกประเมินครบ (ไม่ null, ไม่ 'UNKNOWN') → `STABLE`; (3) มิฉะนั้น (ไม่มีกฎทำงาน และมีฟิลด์อย่างน้อยหนึ่งยังไม่ประเมิน) → `UNKNOWN`, **ไม่เคยเป็น STABLE จากข้อมูลที่ขาด** (GC1). ฟิลด์ทั้งหก: `shockSignsPresent`, `consciousness`, `oxygenSaturationPct`, `maternalPulseBpm`, `bleedingRate`, `fetalTracingPattern` | ☐ อนุมัติตามนี้  ☐ แก้ไขเป็น: ______ |

---

## 4. ช่องว่างที่พบระหว่างพัฒนา — ต้องตัดสินอย่างชัดเจน (Gaps found during implementation)

> สองข้อนี้เป็น **ช่องว่างพฤติกรรมชั่วคราวที่ทีมค้นพบและตรึงไว้ด้วยเคสทดสอบชื่อ "P0-GAP"** ใน
> `tests/fixtures/maternal-screen-clinical-cases.json` เพื่อให้พฤติกรรมปัจจุบันชัดเจน ไม่ใช่เกิดโดยบังเอิญ.
> **แพทย์ต้องเลือกให้ชัดเจน.**

### 4.1 `T1-VOICE-MODERATE-STABLE` — VOICE หรือ MODERATE ควรได้ STABLE จริงหรือ?

**พฤติกรรมปัจจุบัน (provisional):** เมื่อฟิลด์ stability ทั้งหกถูกประเมินครบและไม่มีกฎใดทำงาน ผลจะเป็น **`STABLE`** —
และทั้ง `consciousness == VOICE` (AVPU ต่ำกว่า ALERT หนึ่งขั้น; กฎ `EA-CONSCIOUSNESS-DEPRESSED-EMERGENCY` ทำงานเฉพาะ
`PAIN`/`UNRESPONSIVE`) และ `bleedingRate == MODERATE` (กฎ `EA-BLEEDING-HEAVY-EMERGENCY` ทำงานเฉพาะ `HEAVY`)
**ไม่ทำให้กฎใดทำงานเลย**. ดังนั้นผู้ป่วยที่ตอบสนองด้วยเสียง (VOICE) หรือมีเลือดออกปานกลาง (MODERATE)
ซึ่งอื่น ๆ ประเมินว่าปกติ **ปัจจุบันถูกจัดเป็น คงที่ / STABLE**.

**ข้อเสนอทางวิศวกรรมจาก YAML (candidate remedy):** ยกระดับ `consciousness == VOICE` → **เร่งด่วน / URGENT**
และ `bleedingRate == MODERATE` → **เร่งด่วน / URGENT** (เพิ่มกฎละหนึ่งข้อ) — **หรือ** อนุมัติให้ STABLE เป็นพฤติกรรมที่ตั้งใจ.

| ตัวเลือก | การตัดสิน |
| --- | --- |
| `consciousness == VOICE` → URGENT (เพิ่มกฎใหม่) | ☐ อนุมัติยกระดับเป็น URGENT  ☐ คง STABLE ตามเดิม  ☐ แก้ไขเป็น: ______ |
| `bleedingRate == MODERATE` → URGENT (เพิ่มกฎใหม่) | ☐ อนุมัติยกระดับเป็น URGENT  ☐ คง STABLE ตามเดิม  ☐ แก้ไขเป็น: ______ |

### 4.2 `T1-BLEEDINGRATE-NONE` — "ประเมินแล้ว ไม่มีเลือดออก" แสดงไม่ได้

**พฤติกรรมปัจจุบัน (provisional):** enum `bleedingRate` มีเพียง `SPOTTING | LIGHT | MODERATE | HEAVY | UNKNOWN` —
กรณี "ประเมินแล้ว ไม่มีเลือดออก" **ไม่มีค่าให้แสดง**. ผู้ส่งข้อมูลที่ประเมินแล้วพบว่าไม่มีเลือดออก
ทำได้เพียงส่ง `UNKNOWN` (หรือละเว้นฟิลด์) ซึ่งทำให้ฟิลด์ stability นั้นถือว่า "ยังไม่ประเมิน" ดังนั้นการคัดกรอง
ที่ปกติทุกอย่างจะได้ **ไม่ทราบ / UNKNOWN** แทนที่จะเป็น STABLE. นี่เป็นค่าที่ **ระมัดระวัง** (GC1: ไม่สร้าง STABLE
จากข้อมูลที่ขาด) แต่ทำให้ผู้ป่วยที่ประเมินว่าคงที่จริงถูกประเมินต่ำกว่าความเป็นจริง.

**ข้อเสนอทางวิศวกรรมจาก YAML (candidate remedy):** เพิ่มสมาชิก `NONE` ให้ `bleedingRate` **หรือ** ให้
`vaginalBleeding == false` ถือว่าผ่านเงื่อนไข bleeding-stability.

| ตัวเลือก | การตัดสิน |
| --- | --- |
| เพิ่มค่า `NONE` ให้ enum `bleedingRate` | ☐ อนุมัติ |
| ให้ `vaginalBleeding == false` = bleeding-stable | ☐ อนุมัติ |
| อื่น ๆ | ☐ แก้ไขเป็น: ______________________ |

---

## 5. สิ่งที่ระบบรับประกันอยู่แล้ว — เพื่อทราบ ไม่ต้องตัดสิน (Standing safety invariants)

- **ข้อมูลที่ขาดจะไม่ถูกแสดงเป็นปกติ/สีเขียว** — missing data ไม่เคยกลายเป็น normal/negative (GC1; AC #3).
- **ผลรุนแรงอยู่ร่วมกับข้อมูลที่ไม่ครบได้** — severe result สามารถเกิดพร้อม `isComplete: false`
  (completeness เป็นแกนอิสระจาก tier/acuity; AC #25).
- **"สงสัย" ไม่เท่ากับ "วินิจฉัย"** — suspected ≠ diagnosed เสมอ.
- **ไม่มีสิ่งใดขึ้นสีเขียวที่ใดก่อนการลงนามนี้** — ทุกกฎเป็น shadow-labeled จนกว่าจะอนุมัติ.

---

## 6. การลงนาม (Sign-off block)

> ตาม spec §11 Phase 0 (task 4 บันทึกผู้อนุมัติ/วันที่/เวอร์ชันต้นทาง/เวอร์ชันชุดกฎ; task 9 บันทึก metadata
> การอนุมัติแยกกันสำหรับสองไฟล์) และ AC #24 — **ตาราง local-tier และตาราง acuity ต้องได้รับการอนุมัติแยกกันโดยอิสระ**.
> ตาราง acuity ไม่สามารถทำงานเพียงเพราะตาราง PDF-tier ได้รับอนุมัติ.

### 6.1 บล็อกลงนาม ตาราง Local-tier (`docs/clinical/maternal-screen-rules-v1.yaml`)

รับรองการตัดสินในหัวข้อ §3.1–§3.6 และ §3.8 (preeclampsia + APH + mandatory fields + ranking).

| รายการ | ค่า |
| --- | --- |
| ชื่อ-สกุล (Name) | ______________________________________ |
| ตำแหน่ง (Position) | ______________________________________ |
| เลขใบประกอบวิชาชีพ (License no.) | ______________________________________ |
| หน่วยงาน (Organization) | ______________________________________ |
| วันที่ (Date) | ______________________________________ |
| ลายมือชื่อ (Signature) | ______________________________________ |
| เวอร์ชันชุดกฎที่กำหนดเมื่อลงนาม (Rule-set version to assign) | `__________` _(เสนอ: `1.0.0`)_ |

### 6.2 บล็อกลงนาม ตาราง Emergency-acuity (`docs/clinical/maternal-screen-acuity-v1.yaml`)

รับรองการตัดสินในหัวข้อ §3.7, §3.9 และช่องว่าง §4.1–§4.2 (acuity thresholds + STABLE/UNKNOWN + P0 gaps).

| รายการ | ค่า |
| --- | --- |
| ชื่อ-สกุล (Name) | ______________________________________ |
| ตำแหน่ง (Position) | ______________________________________ |
| เลขใบประกอบวิชาชีพ (License no.) | ______________________________________ |
| หน่วยงาน (Organization) | ______________________________________ |
| วันที่ (Date) | ______________________________________ |
| ลายมือชื่อ (Signature) | ______________________________________ |
| เวอร์ชันชุดกฎที่กำหนดเมื่อลงนาม (Rule-set version to assign) | `__________` _(เสนอ: `1.0.0`)_ |

---

## 7. สิ่งที่จะเกิดขึ้นหลังลงนาม (What engineering does after signature)

1. **พลิกสถานะอนุมัติ** — เปลี่ยน `approved: false` → `true` และเติม `approvedBy` / `approvedAt` ในทั้งสอง YAML
   (และในทะเบียนหลักฐาน).
2. **ใส่การแก้ไข** — บันทึกทุกช่อง "แก้ไขเป็น" ที่แพทย์เขียนเข้าไปในกฎ (เช่น ยกระดับ VOICE/MODERATE, เพิ่มค่า `NONE`).
3. **เลื่อนเวอร์ชันชุดกฎ (bump)** — `ruleSetVersion: "0.1.0-provisional"` → เวอร์ชันที่รับรอง (เสนอ `1.0.0`)
   และ `status: PROVISIONAL_UNAPPROVED` → `APPROVED`.
4. **สร้าง/ตรวจซ้ำ oracle 66 เคส** — regenerate และ re-verify เคสทดสอบ 66 เคสให้ตรงกับกฎที่แก้ไข.
5. **ลำดับการเปิดใช้งาน (activation sequence, spec §17.2):**
   - เปิด **ingest** ที่โรงพยาบาลนำร่องหนึ่งแห่ง → เปิด **shadow calculation** และเทียบผลกับแพทย์
     → แก้และบันทึกทุก severe mismatch → **เปิด alerts/events เฉพาะหลังการยอมรับ (acceptance)** เท่านั้น
     → ขยายทีละโรงพยาบาลพร้อม monitoring.

**หมายเหตุ:** จนกว่าจะครบขั้นตอนข้างต้น หลักฐาน acuity, concealed-bleeding, rupture และ CTG
ยังเป็น capture-only / shadow evidence และ **ขับเคลื่อน production alert ไม่ได้** (spec §11 exit gate).
