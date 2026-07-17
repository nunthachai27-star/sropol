# แก้ Login 403 / 405 / SSE พัง — IIS Reverse Proxy (surintelehealth.com/sr-lrms)

> อาการ: `POST /sr-lrms/api/auth/callback/credentials` → **403**, `POST /sr-lrms/login` → **405 Method Not Allowed**, SSE → `MIME type text/html not text/event-stream`
>
> สาเหตุ: **IIS (Microsoft-IIS/8.5) ที่อยู่หน้าเว็บ ไม่ได้ proxy ทุก route/verb ของ `/sr-lrms/*` ไป Next.js (docker)** → POST/API/SSE ตกไปที่ static handler → 405/403/HTML. **ไม่ใช่บั๊กโค้ด** — เป็น IIS + `.env` ฝั่ง server

---

## 1. เปิด ARR (ทำครั้งเดียวที่ระดับ Server)

ต้องมี **Application Request Routing** + **URL Rewrite** ติดตั้งใน IIS แล้ว จากนั้น:

`IIS Manager → เลือก Server (ชื่อเครื่อง) → Application Request Routing Cache → (ขวา) Server Proxy Settings → ✅ Enable proxy → Apply`

ถ้าไม่เปิดตรงนี้ rule แบบ `Rewrite → http://...` จะไม่ทำงานเลย

## 2. `web.config` ของ site (วางที่ root ของ site ที่ครอบ /sr-lrms)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>

    <rewrite>
      <rules>
        <!-- proxy ทุกอย่างใต้ /sr-lrms/* ไป Next.js (docker nginx) — ทุก verb (GET/POST/...) -->
        <rule name="ProxyToNext-sr-lrms" stopProcessing="true">
          <match url="^sr-lrms/(.*)" />
          <action type="Rewrite" url="http://172.18.1.155:8080/sr-lrms/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
            <set name="HTTP_X_FORWARDED_HOST"  value="surintelehealth.com" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>

    <!-- Request Filtering: อนุญาต POST/ทุก verb + URL auth มี %2F encoded -->
    <security>
      <requestFiltering allowDoubleEscaping="true">
        <verbs allowUnlisted="true" />
      </requestFiltering>
    </security>

  </system.webServer>
</configuration>
```

> ต้องอนุญาต server variable `HTTP_X_FORWARDED_PROTO` / `HTTP_X_FORWARDED_HOST` ก่อน:
> `URL Rewrite → (ขวา) View Server Variables → Add… → HTTP_X_FORWARDED_PROTO` และ `HTTP_X_FORWARDED_HOST`

## 3. ปิด response buffering เพื่อให้ SSE (dashboard real-time) ทำงาน

ARR buffer response โดย default → SSE (`/api/sse/*`) จะค้าง/คืน HTML. แก้ที่ระดับ server:

`IIS Manager → Server → Application Request Routing Cache → Server Proxy Settings → "Response buffer threshold (KB)" = 0 → Apply`

(หรือใน `applicationHost.config`: `<proxy ... responseBufferLimit="0" preserveHostHeader="true" />`)

- `responseBufferLimit=0` → SSE stream ไหลทันที
- `preserveHostHeader=true` → NextAuth เห็น host จริง (surintelehealth.com) ไม่ใช่ IP ภายใน

## 4. `.env` ฝั่ง server (สำคัญ — แก้ callback ชี้ IP ภายใน 172.18.1.155)

```bash
NEXTAUTH_URL=https://surintelehealth.com/sr-lrms
AUTH_TRUST_HOST=true
NEXT_PUBLIC_BASE_PATH=/sr-lrms
```
(cookie `authjs.callback-url=http://172.18.1.155:8080` = อาการที่ `NEXTAUTH_URL` ผิด)

## 5. Deploy

```bash
git pull origin main        # ได้ ANC 500 fix + labor dchdate fix
npm run deploy              # docker compose up -d --build (NEXT_PUBLIC_BASE_PATH ต้องตั้งตอน build)
```

## 6. ตรวจหลัง deploy
- [ ] Login ผ่าน (ไม่ 403/405) → เข้า /pregnancies ได้
- [ ] Dashboard real-time อัปเดต (SSE ไม่ error)
- [ ] หน้า ANC Registry ทุก รพ. เปิดได้ (ไม่ 500)
- [ ] ห้องคลอด ท่าตูม ไม่บวม 162 (ตัดซากจำหน่ายแล้ว)

---

### สรุปว่าอะไรอยู่ตรงไหน
| ปัญหา | แก้ที่ | อยู่ใน repo ไหม |
|---|---|---|
| 403/405 POST, SSE HTML | IIS web.config + ARR (ข้อ 1-3) | ❌ (server) |
| callback ชี้ IP ภายใน | `.env` NEXTAUTH_URL (ข้อ 4) | ❌ (server secret) |
| ANC 500 / labor over-count | โค้ด (merge เข้า main แล้ว) | ✅ deploy ข้อ 5 |
