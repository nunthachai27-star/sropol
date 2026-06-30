# คู่มือติดตั้ง HOSxP Webhook Push (SR-LRMS / สุรินทร์)

> เป้าหมาย: ให้แต่ละโรงพยาบาล **sync ข้อมูลเข้า SR-LRMS ได้ตลอด 24 ชม. โดยไม่ต้องมีคนเปิดแท็บเบราว์เซอร์ค้างไว้** — ใช้ HOSxP ฝั่งโรงพยาบาล "push" ข้อมูลขึ้นมาเองแบบ server-to-server

---

## 1. ทำไมต้องใช้ webhook push

ปัจจุบัน SR-LRMS ดึงข้อมูลผ่าน **browser-poll** เท่านั้น (server-side polling ปิดอยู่ — ดู [startup.ts](../src/app/api/startup.ts)) ซึ่งดึง HOSxP ผ่าน:

1. **Local gateway** `http://127.0.0.1:45011` — มีเฉพาะบนเครื่องในเครือข่าย รพ. ที่ติดตั้ง BMS gateway
2. **Public tunnel** `https://<hcode>-xxx.tunnel.hosxp.net` — แต่ tunnel **block CORS** จากเบราว์เซอร์

→ รพ. จะ sync ได้ **ก็ต่อเมื่อมีเครื่องในเครือข่าย รพ. login + เปิดแท็บค้าง** รพ.ที่ไม่มีเครื่องเปิด (เช่น ปราสาท) จะขึ้น **No sync (UNKNOWN)** ตลอด

**Webhook push แก้ปัญหานี้:** HOSxP เป็นฝ่ายส่งข้อมูลขึ้น SR-LRMS เอง ไม่ผ่านเบราว์เซอร์/gateway/CORS เลย

```
[HOSxP รพ.]  --(timer 5 นาที + event)-->  POST https://surintelehealth.com/sr-lrms/api/webhooks/patient-data
   ตัว push = KKLRMSWebhookUnit.pas                       (Bearer kklrms_xxx)
```

---

## 2. สถานะความพร้อม

| ฝั่ง | สถานะ | หมายเหตุ |
|---|---|---|
| **SR-LRMS (ฝั่งรับ)** | ✅ พร้อมแล้ว | endpoint + auth + full_snapshot/auto-discharge มีครบ |
| **HOSxP (ฝั่งส่ง)** | ⚠️ ต้องแก้ก่อน | `KKLRMSWebhookUnit.pas` ฮาร์ดโค้ดไป **Khon Kaen** ต้องแก้ host/path เป็น Surin (ข้อ 4.2) |

ฝั่งรับ ([patient-data/route.ts](../src/app/api/webhooks/patient-data/route.ts)) รองรับ payload: `anc_data`, labor (default), `referral`, `referral_update`, partograph

---

## 3. ขั้นตอนฝั่ง SR-LRMS — สร้าง API Key (ทำต่อ รพ.)

1. login เป็น **ผู้ดูแลระบบ (provincial admin)**
2. ไป **ตั้งค่า → Webhook Keys** → กดสร้าง key ใหม่ เลือกโรงพยาบาล + ตั้ง label
3. ระบบออก key รูปแบบ **`kklrms_` + hex 40 ตัว (รวม 47 ตัวอักษร)** — **แสดงครั้งเดียว** กรุณาคัดลอกเก็บทันที
   - (เบื้องหลัง: [createApiKey / generateApiKey](../src/services/webhook.ts))

> key ผูกกับ `hospitalId` หนึ่ง รพ. — payload ที่ส่งมาต้องมี `hospitalCode` ตรงกับ รพ. ของ key ไม่งั้นได้ 403 `HOSPITAL_CODE_MISMATCH`

---

## 4. ขั้นตอนฝั่ง HOSxP

### 4.1 ติดตั้ง unit
นำ [`docs/hosxp/KKLRMSWebhookUnit.pas`](hosxp/KKLRMSWebhookUnit.pas) เข้าโปรเจกต์ HOSxP (BMS)

### 4.2 ⚠️ แก้ค่าให้ชี้มา Surin (สำคัญที่สุด)
ไฟล์ปัจจุบันชี้ไป Khon Kaen — แก้ค่าคงที่ (ประมาณบรรทัด 83-86, 224):

```pascal
// เดิม (Khon Kaen)
KKLRMS_HOST = 'kk-lrms.bmscloud.in.th';
KKLRMS_PATH = '/api/webhooks/patient-data';
KKLRMS_CHECK_PATH = '/api/referrals/check';

// แก้เป็น (Surin) — สังเกต path ต้องมี /sr-lrms นำหน้า (basePath ของ deployment)
KKLRMS_HOST = 'surintelehealth.com';
KKLRMS_PATH = '/sr-lrms/api/webhooks/patient-data';
KKLRMS_CHECK_PATH = '/sr-lrms/api/referrals/check';
```
(`KKLRMS_PORT = '443'`, scheme `https` ใช้ค่าเดิมได้ — PROD)

> **ข้อเสนอแนะ:** ถ้าจะใช้ unit เดียวกับหลายจังหวัด ควรทำให้ host/path อ่านจาก `webhook_setting` ด้วย จะได้ไม่ต้อง recompile ต่อ deployment

### 4.3 ตั้งค่า API key ใน HOSxP
unit อ่าน key จากตาราง `webhook_setting` (ดู `GetConfig` ใน .pas) — เพิ่ม/แก้แถว:

```sql
-- webhook_module_id = 3, code = 'KK-LRMS', active = 'Y'
INSERT INTO webhook_setting
  (webhook_module_id, webhook_setting_code, webhook_authorization_key, webhook_active)
VALUES
  (3, 'KK-LRMS', 'kklrms_xxxxxxxx...(key จากข้อ 3)', 'Y');
-- HOSPITAL_CODE: ใช้รหัส รพ. 5 หลักของตัวเอง (unit อ่านจาก config รพ.)
```

### 4.4 ผูก event + timer
```pascal
// หลังบันทึกการคลอด (labour entry save):
SendKKLRMSLabourData(FAN);
// หลังบันทึก ANC:
SendKKLRMSANCData(FPersonANCID);
// หลังสร้าง refer out (รพ.ต้นทาง):
SendKKLRMSReferralCreate(FReferoutID);
// รับสถานะ refer (รพ.ปลายทาง):
SendKKLRMSReferralUpdate(FReferinVN, 'ACCEPTED', 'reason');

// ⭐ Timer ทุก 5 นาที (สำคัญ — เป็นตัวที่ทำให้ sync ตลอดไม่ต้องเปิดแท็บ):
SendKKLRMSLabourSnapshot;
```

**`SendKKLRMSLabourSnapshot`** ส่ง active labor ทั้งหมดแบบ **`full_snapshot`** → คนไข้ที่ไม่อยู่ใน snapshot จะถูก **auto-discharge** บน dashboard อัตโนมัติ (ถ้า >100 ราย unit จะแบ่ง chunk ละ 100 เป็น `incremental` — server cap)

---

## 5. ตรวจสอบว่าใช้งานได้

1. หลังตั้ง timer ~5 นาที → ไป **ตั้งค่า → Sync Status** หรือหน้า รพ. → **Sync Log** ของ รพ.นั้น
2. ควรเห็นรอบที่ `trigger = webhook` เข้ามา + จำนวน `patientsProcessed`
3. หน้า รพ. ควรขึ้น **ACTIVE LABOR / ANC** ตามจริง และสถานะเปลี่ยนจาก No sync
4. ทดสอบ key เร็วๆ (ฝั่ง รพ. หรือ curl):
   ```bash
   curl -X POST https://surintelehealth.com/sr-lrms/api/webhooks/patient-data \
     -H "Authorization: Bearer kklrms_xxx" -H "Content-Type: application/json" \
     -d '{"type":"anc_data","hospitalCode":"10918","patients":[]}'
   ```
   - 401 = key ผิด/หาย · 403 = hospitalCode ไม่ตรง key · 200 = ผ่าน

---

## 6. ข้อควรระวัง

- **path ต้องมี `/sr-lrms`** — ลืมบ่อยสุด ถ้าขาดจะได้ 404
- **PDPA:** ข้อมูลส่งผ่าน HTTPS · key เก็บใน `webhook_setting` ของ HOSxP เท่านั้น อย่า log key เต็ม
- **CID:** payload ที่ CID ไม่ผ่าน checksum ก.พ. จะถูก skip รายตัว (ดู [cid.ts](../src/lib/cid.ts)) — ไม่ทำให้ทั้ง batch ล้ม
- **webhook push กับ browser-poll อยู่ร่วมกันได้** — รพ.ที่ลง webhook แล้วไม่ต้องเปิดแท็บอีก แต่ถ้าเปิดก็ไม่พัง (full_snapshot reconcile ตรงกัน)

---

## 7. Checklist ต่อโรงพยาบาล

- [ ] สร้าง API key ใน SR-LRMS admin (ข้อ 3)
- [ ] แก้ `KKLRMS_HOST` + `KKLRMS_PATH` + `KKLRMS_CHECK_PATH` เป็น Surin (ข้อ 4.2)
- [ ] ติดตั้ง unit + compile เข้า HOSxP (ข้อ 4.1)
- [ ] เพิ่มแถว `webhook_setting` ใส่ key (ข้อ 4.3)
- [ ] ผูก event labour/ANC/referral (ข้อ 4.4)
- [ ] ตั้ง timer 5 นาที เรียก `SendKKLRMSLabourSnapshot` (ข้อ 4.4)
- [ ] ยืนยันใน Sync Log เห็น `trigger=webhook` (ข้อ 5)
