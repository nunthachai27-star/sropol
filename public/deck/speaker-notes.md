# KK-LRMS · MOPH Executive Briefing · Speaker Notes
**Date:** 26 พ.ค. 2569 · 12:00 · Total: ~13:25 + 1:35 buffer

> Open the deck at `public/deck/index.html` in Chrome. Press **N** to toggle speaker-notes overlay on the presenter laptop. Press **B** to access backup slides. Press arrow keys / spacebar to navigate.

---

## Pre-presentation checklist (10 min before)

- [ ] Deck file open in Chrome 1920×1080, full screen (F11)
- [ ] Mirror display set to "Extend" (so overlay stays on laptop only)
- [ ] Internet connection verified (for Google Fonts CDN)
- [ ] Slide 7 metrics verified against latest prod data
- [ ] Slide 8 patient case + physician sign-off confirmed
- [ ] Slide 11 presenter name + email + phone filled in
- [ ] Spare USB with `kk-lrms-deck-2026-05-26.zip` ready
- [ ] Speaker timer set (15:00 countdown)

---

## Slide 1 — Cold Open (40s)
> *Pause on the map for 5 seconds before speaking.*

"ก่อนผมจะเริ่ม ขอให้ทุกท่านมองหน้าจอนี้สักครู่ครับ... จุดทองที่เห็นคือจังหวัดขอนแก่น และวันนี้ ขอนแก่นเป็น **จังหวัดเดียวในประเทศไทย** ที่สูติแพทย์ที่โรงพยาบาลแม่ข่ายสามารถเห็นผู้คลอดทุกคนในโรงพยาบาลชุมชนทั้ง 26 แห่ง ภายใน 30 วินาที"

"ผมมาวันนี้เพื่อขอให้ภาพนี้... ขยายไปทั่วเขตสุขภาพที่ 7 และเดินทางต่อไปสู่ทุกจังหวัดในประเทศไทย"

## Slide 2 — Problem (90s)

"ค่าเฉลี่ย MMR ของประเทศเราอยู่ที่ ~17 ต่อแสนการคลอด แต่ค่าเฉลี่ยซ่อนความเหลื่อมล้ำไว้ ในชนบทบางพื้นที่ยังเกินค่าเฉลี่ย"

"ทางขวาคือเส้นทางข้อมูลในปัจจุบันที่โรงพยาบาลชุมชน 26 แห่งใช้กันอยู่ — รายงานด้วยปากเปล่า หรือ LINE และสูติแพทย์ที่ รพศ. ตัดสินใจ refer จากเพียงข้อความ"

"**ความล่าช้า 30 ถึง 90 นาที** ในเคสที่เวลาคือชีวิต"

## Slide 3 — Dashboard (60s)

"นี่คือสิ่งที่เราสร้างขึ้นที่ขอนแก่น — หน้าจอเดียว เห็นทุกห้องคลอดทั่วจังหวัด"

"26 โรงพยาบาล · อัปเดตทุก 30 วินาที · CPD score คำนวณอัตโนมัติจาก HOSxP"

"สีเขียวคือความเสี่ยงต่ำ เหลืองคือกลาง แดงคือสูง — สูติแพทย์เห็นภาพรวมทั้งจังหวัดได้ภายในวินาทีเดียว"

## Slide 4 — Clinical Intelligence (75s)

"CPD score คำนวณจาก 8 ปัจจัยทางคลินิก — gravida, ANC visits, GA, ส่วนสูง, น้ำหนัก, fundal height, U/S fetal weight, hematocrit คะแนน ≥ 10 ระบบแนะนำ refer ทันที"

"ทางขวาคือ digital partograph — เส้น alert และ action line ตามมาตรฐาน WHO partograph"

"**ทุกข้อมูลมาจาก HOSxP โดยตรง — ไม่มีการพิมพ์ซ้ำ ไม่มีข้อผิดพลาดจากมนุษย์**"

## Slide 5 — Cross-Hospital Tracking (60s)

"เมื่อผู้ป่วย refer ระบบจะ match ประวัติข้ามโรงพยาบาลโดยใช้ CID hash SHA-256"

"**เลขบัตรประชาชนตัวจริงไม่เคยถูกเก็บ plaintext** ที่ไหนเลย"

"สูติแพทย์ที่รับ refer เห็นประวัติเต็มก่อนรถถึง — ไม่ต้องถามซ้ำที่ ER ไม่เสียเวลาในช่วงวิกฤต"

## Slide 6 — Coverage + PDPA (90s)

"ระบบรองรับทั้งโรงพยาบาลที่ใช้ HOSxP และไม่ใช้ HOSxP"

"HOSxP → auto-sync ผ่าน BMS Session API โหมด **browser-only** — PHI ไม่ออกจาก network โรงพยาบาลเลย"

"Non-HOSxP → push ผ่าน webhook REST API พร้อม API key และ signature"

"ทางขวา 5 ข้อ คือมาตรการ PDPA — เข้ารหัส AES-256, hash CID, role-based access, audit log, mask ชื่อบน dashboard"

## Slide 7 — Built to Run (60s)

*[Read out the 6 metrics naturally]*

"ระบบที่กำลังทำงานอยู่ในปัจจุบัน — **26 โรงพยาบาล**, **287 ผู้ป่วยในระบบ**, **99.4% sync success rate**, **87 วัน uptime ต่อเนื่อง**, **463 ชุดทดสอบ**, latency น้อยกว่า **2 วินาที**"

"**นี่ไม่ใช่ prototype — นี่คือ production**"

## Slide 8 — Real Patient Case (90s)

"ขออนุญาตเล่าเรื่องจริงครับ — **เคสนี้เกิดขึ้นที่ [ระบุชื่อ รพช.] เมื่อ [ระบุวันที่]**"

*[Walk through the timeline naturally, 7 events]*

- 14:23 G1 อายุ 17 รับเข้า รพช. [X]
- 14:24 KK-LRMS sync → CPD score 11 (High Risk)
- 14:25 แจ้งเตือนสูติแพทย์เวรที่ รพศ.
- 14:30 สูติแพทย์เปิด partograph + ANC history
- 14:45 **ตัดสินใจ refer ทันที — เร็วกว่า workflow เดิม ~45 นาที**
- 16:10 ผู้ป่วยถึง รพศ. — ทีมพร้อม ข้อมูลเต็ม
- 17:50 **C/S สำเร็จ · แม่และทารกปลอดภัย**

"นี่คือเหตุผลที่เรามาขอวันนี้ครับ — เพื่อให้เคสแบบนี้เกิดขึ้นได้ในทุกจังหวัด"

## Slide 9 — Scale Path (90s)

"แผนเดินทาง — 1 → 7 → 76"

"ปี 2569 ขอนแก่นใช้งานแล้ว — 26 รพช. + 1 รพศ."

"**ถ้าวันนี้ได้รับการรับรอง** เราขยายเขตสุขภาพที่ 7 ใน Q1–Q3 ปีหน้า — 7 จังหวัด ~150 โรงพยาบาล"

"Q4 ปีหน้าเปิดเป็น MOPH-managed service"

"ปี 2571 ครบทุกเขตสุขภาพ — 13 เขต ~900 โรงพยาบาล"

## Slide 10 — 6-Week Onboarding (60s)

"6 สัปดาห์ต่อจังหวัด"

- W1: ลงนาม MOU + ผู้ประสานงาน สสจ.
- W2–3: เปิด BMS Session tunnel + ทดสอบ sync
- W3–4: คัดกรองข้อมูล + อบรมพยาบาล/สูติแพทย์
- W5: Pilot run 1 รพ.
- W6: Rollout 5+ รพ. + handover

"1 ทีม technical รองรับได้ 3 จังหวัดพร้อมกัน — Region 7 ใช้ 2 ทีม ใช้เวลาประมาณ 4 เดือนทั้งเขต"

## Slide 11 — The Ask (60s)

"สิ่งที่เราขอจากบอร์ดวันนี้ครับ — **สี่อย่าง**"

1. **หนังสือเห็นชอบจาก สป.สธ.** ขยายผลสู่เขตสุขภาพที่ 7
2. **บรรจุใน Service Plan** รอบ FY 2570
3. **กรอบงบประมาณ FY 2570** (hosting + onboarding + ops)
4. **มอบหมายเชื่อมโยงข้อมูลกับ HDC** (Digital Health)

"ทั้งสี่อย่างเป็น **package** ครับ — ขาดอย่างใดอย่างหนึ่งการขยายผลจะติดขัด"

## Slide 12 — Thank You (30s)

"ขอบคุณบอร์ดผู้บริหารทุกท่านครับ"

"ข้อมูลระบบเพิ่มเติมสแกน QR ได้ — `kk-lrms.bmscloud.in.th/about`"

"ผมยินดีตอบคำถามครับ"

---

## Backup slides — quick map (press B to access)

| Key | Slide | Use when |
|---|---|---|
| B1 | Technical stack | Digital Health committee drills into architecture |
| B2 | Onboarding cost | PS asks for budget specifics |
| B3 | PDPA compliance mapping | Legal asks about specific compliance |
| B4 | 6-month measurement plan | Anyone asks "how will you prove it works?" |
| B5 | Risk register | Anyone asks about failure modes |
| B6 | Comparison vs HDC / cloud / HOSxP-XE | "Why not use [other system]?" |

---

## Likely Q&A

**Q: ค่าใช้จ่ายเท่าไหร่?** → B2 + ตัวเลขที่เตรียมไว้
**Q: ใครเป็นเจ้าของข้อมูล?** → สสจ.ขอนแก่น (ตาม PDPA + DPA)
**Q: ถ้า HOSxP เปลี่ยน schema แล้วระบบล่ม?** → Adapter layer + integration tests
**Q: แล้ว HDC ใช้ทำอะไรไม่ได้เหรอ?** → B6 — HDC = reporting, not real-time labor monitoring
**Q: ใครทำงานต่อจากนี้?** → ทีม สสจ.ขอนแก่น + ผู้พัฒนา + MOPH ITS เมื่อขยายเป็น national
**Q: ขอนแก่นใช้แล้วเห็นผลอย่างไร?** → Slide 8 (case story) + B4 (measurement plan)
