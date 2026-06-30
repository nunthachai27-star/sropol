# Design — Refer-out Pull เข้า Browser-Poll

> วันที่: 2026-06-30 · สถานะ: อนุมัติ design แล้ว (รอ implementation plan)
> ขอบเขต: SR-LRMS / สุรินทร์ — ดึงข้อมูล **ส่งต่อออก (refer-out)** ของหญิงตั้งครรภ์เข้าระบบผ่าน browser-poll โดย **ไม่ต้องแก้ HOSxP**

## 1. ที่มา / ปัญหา

ปัจจุบัน browser-poll ดึงจาก HOSxP ได้ 5 ชนิด (labor, partograph, ANC masters/visits/classify) แต่ **ไม่ดึง referral** — referral เข้าระบบได้ทางเดียวคือ webhook push (`KKLRMSWebhookUnit.pas`) ซึ่งต้องติดตั้ง/แก้ HOSxP ฝั่ง รพ. ผลคือหน้า "ข้อมูลส่งต่อ" ของสุรินทร์ว่างเปล่า

จากการศึกษา deployment ขอนแก่น (kk-lrms.bmscloud.in.th): KK มี referral ทำงาน (20+ รายการ, alert 99) เพราะ รพ. **ติดตั้ง .pas แล้ว** แต่สุรินทร์เลือกแนวทางที่ไม่แก้ HOSxP → เติม referral เข้า browser-poll แทน

**เป้าหมาย:** referral ส่งต่อออกของหญิงตั้งครรภ์ที่ระบบติดตามอยู่ ปรากฏบน dashboard เมื่อ รพ.ต้นทางมี browser-poll session เปิดอยู่ — เหมือน labor/ANC ทุกประการ

## 2. ขอบเขต (ตัดสินใจแล้ว)

| ประเด็น | การตัดสินใจ |
|---|---|
| ทิศทาง | **refer-out อย่างเดียว (MVP)** — รพ.ต้นทาง poll `referout` ของตัวเอง ไม่ track สถานะรับฝั่งปลายทาง (referin) |
| การกรอง | **เฉพาะหญิงตั้งครรภ์ที่มี maternal_journey ในระบบแล้ว** (จับคู่ด้วย CID) — ไม่สร้าง phantom journey |
| ช่วงเวลา | `refer_date` ย้อนหลัง **7 วัน** (idempotent upsert ทุกรอบ poll) |
| เจอ refer แต่ไม่ track | **ข้าม** + log จำนวน (ไม่เงียบ) |
| แนวทาง | **A — ต่อท่อ referral เข้า pipeline เดิม** (reuse `processReferralCreate`) |

**ไม่อยู่ในขอบเขต MVP:** referin/สถานะปลายทาง (accepted/in-transit/arrived), การลบ refer ที่ถูกยกเลิกใน HOSxP, การสร้าง journey ใหม่จากข้อมูล referral

## 3. Architecture

referral = "ชนิดข้อมูลที่ 6" ของ browser-poll ต่อขนานกับ labor/ANC/partograph — **ไม่มี service / table / UI ใหม่**

```
HOSxP (gateway 127.0.0.1:45011)
   │  ① SQL_REFEROUT_OB  (query ใหม่ใน browser-poll.ts)
   ▼
useBrowserPoll → bundle { labor, anc, partograph, referrals[] }   ← เพิ่ม referrals
   │  ② POST /api/sync/browser-push  (session-auth, hospital = sender)
   ▼
browser-push route → step "persist_referrals"                      ← branch ใหม่
   │  ③ processReferralCreate(skipIfUntracked:true) ต่อรายการ        ← option ใหม่
   ▼
cached_referrals  +  SSE 'patient-update'  (เดิม → UI เด้งเอง)
```

**ไฟล์ที่แก้ (3):**
- `src/lib/browser-poll.ts` — query `SQL_REFEROUT_OB` + map → `WebhookReferralCreatePayload[]` + เพิ่มเข้า `Promise.all` ของ `runBrowserPoll`
- `src/app/api/sync/browser-push/route.ts` — เพิ่ม `referrals` ใน `BrowserPushBody` + branch/step `persist_referrals`
- `src/services/webhook.ts` — เพิ่ม option `skipIfUntracked` ใน `processReferralCreate`

## 4. Components & Field Mapping

### ① `SQL_REFEROUT_OB` (browser-poll.ts)
ดึง referout ฝั่งต้นทาง OB-scoped 7 วัน:
```sql
FROM referout ro
  JOIN patient p     ON p.hn = ro.hn
  LEFT JOIN person pe ON pe.cid = p.cid
WHERE ro.refer_date >= :since            -- now() - 7 วัน
  AND (ro.pdx LIKE 'O%' OR ro.pdx LIKE 'Z3%'
       OR EXISTS (SELECT 1 FROM person_anc pa WHERE pa.cid = p.cid))
```
> predicate OB เป็น **ตัวกรองหยาบฝั่ง HOSxP เพื่อลดปริมาณ** เท่านั้น ตัวกรองจริง ("เฉพาะที่ track") อยู่ฝั่ง server (③)
> **ต้อง validate กับ HOSxP จริงตอน implement** — ชื่อคอลัมน์ `pdx` / `refer_date` / การ join อาจต่างตามรุ่น (อ้างอิง `REFEROUT_PREGNANCY` ใน `hosxp-queries.ts` + `.pas` SendKKLRMSReferralCreate)

### ② map row → `WebhookReferralCreatePayload`

| payload field | ← HOSxP | หมายเหตุ |
|---|---|---|
| `referralId` | `ro.refer_number` | compound key กับ from_hospital (upsert) |
| `hn` | `ro.hn` | |
| `cid` | `p.cid` | validate checksum ก่อนส่ง |
| `name` | `pe.fname + ' ' + pe.lname` | เข้ารหัสฝั่ง server |
| `toHospitalCode` | `ro.refer_hospcode` | รพ.ปลายทาง |
| `reason` | `ro.pre_diagnosis` / `diagnosis_text` | |
| `diagnosisCode` | `ro.pdx` | ICD-10 |
| `urgencyLevel` | map `referout_emergency_type_id` → `ROUTINE`/`URGENT`/`EMERGENCY` | |
| `changwatCode/amphurCode/tambonCode` | `p.chwpart/amppart/tmbpart` | |
| `hospitalCode` | จาก session (browser-push) | = รพ.ต้นทาง ไม่ map จาก row |

### ③ `processReferralCreate(..., opts?: { skipIfUntracked?: boolean })`
แก้ branch `else` (เดิมสร้าง phantom journey เมื่อ `!hasMonitoringData`):
- ถ้า `!hasMonitoringData && opts.skipIfUntracked` → `return { referralId, status: 'SKIPPED_UNTRACKED' }` (ไม่ insert `cached_referrals`, ไม่สร้าง `maternal_journeys`)
- webhook path เดิมไม่ส่ง option → ค่า default `false` → **พฤติกรรมเดิมไม่เปลี่ยน**

## 5. Error Handling & Edge Cases

| กรณี | พฤติกรรม |
|---|---|
| CID ไม่ผ่าน checksum ก.พ. | skip รายตัว (validate ก่อนเรียก processReferralCreate) ไม่ล้ม batch |
| ไม่ track (ไม่มี journey/labor) | `SKIPPED_UNTRACKED` + นับ + log `referrals_skipped_untracked: N` |
| `refer_hospcode` ไม่อยู่ในระบบ | throw "ไม่พบ รพ.ปลายทาง" → catch รายตัว นับ `failed` ไม่ล้ม batch |
| referout query พัง (คอลัมน์ไม่ตรงรุ่น) | step `persist_referrals` = `error` + detail; **labor/anc/partograph ยัง persist ปกติ** (try/catch แยก step) |
| ดึงซ้ำทุกรอบ poll | upsert by `(from_hospital_id, refer_number)` → idempotent |
| refer ถูกยกเลิกใน HOSxP | MVP **ไม่ลบ** — refer เก่าหลุดออกนอก window 7 วันเองตามเวลา |

step `persist_referrals` รายงาน `{ processed, skippedUntracked, skippedBadCid, failed }` → เห็นใน Sync Log (constitution V)

## 6. Testing Plan (TDD — Red ก่อน Green)

1. **`processReferralCreate` skipIfUntracked** (`webhook.test`) — patient ไม่มี journey/labor + `skipIfUntracked:true` → คืน `SKIPPED_UNTRACKED`, ไม่ insert `cached_referrals`, ไม่สร้าง `maternal_journeys` · และ default (ไม่ส่ง option) → พฤติกรรมเดิม (สร้าง phantom) ยังผ่าน
2. **map referout → payload** (`browser-poll.test`) — row ดิบ → payload ครบ field, urgency map ถูก, name = fname+lname
3. **browser-push referrals branch** (`browser-push.test`) — bundle มี `referrals[]` → เรียก processReferralCreate ต่อราย, step `persist_referrals` นับถูก, CID เสีย → skip, ปลายทางไม่พบ → failed ไม่ล้ม labor
4. **idempotent** — ยิง bundle เดิม 2 รอบ → `cached_referrals` 1 แถว

Vitest + SQLite in-memory · ไม่แตะ E2E (validate query จริงด้วย live HOSxP session ตอน implement)

## 7. Constitution Compliance

- **III/IV (DRY / centralized logic):** reuse `processReferralCreate` ทั้งก้อน ไม่เขียน logic referral ซ้ำ
- **I (safety):** parameterized query, เข้ารหัส name/cid (PDPA), validate CID ที่ boundary
- **II (TDD):** เขียน test ก่อนทุก unit (§6)
- **V (UX):** step `persist_referrals` + นับผลใน Sync Log ภาษาไทย ไม่ skip เงียบ
