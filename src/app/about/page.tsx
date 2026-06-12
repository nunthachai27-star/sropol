// About page — public, accessible without login
import Link from 'next/link';
import {
  Building2,
  Activity,
  BarChart3,
  Shield,
  Clock,
  HeartPulse,
  AlertTriangle,
  Users,
  ArrowLeft,
  Baby,
  Stethoscope,
  Network,
  Bell,
  Printer,
  ChevronRight,
  Webhook,
  Key,
  FileJson,
  Send,
  CheckCircle2,
  XCircle,
  Globe,
} from 'lucide-react';
import { APP_VERSION_LABEL } from '@/lib/app-version';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-2xl font-bold text-slate-800 mb-4 flex items-center gap-2">
      {children}
    </h2>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)]">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-teal-600 mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-slate-800 mb-2">{title}</h3>
      <p className="text-slate-500 leading-relaxed">{description}</p>
    </div>
  );
}

function HospitalLevelRow({
  level,
  name,
  description,
}: {
  level: string;
  name: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4 py-3 border-b border-slate-100 last:border-0">
      <span className="shrink-0 rounded-lg bg-teal-50 px-3 py-1 text-sm font-bold text-teal-700 font-mono">
        {level}
      </span>
      <div>
        <span className="font-semibold text-slate-700">{name}</span>
        <p className="text-sm text-slate-400 mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function RiskLevelCard({
  color,
  bgColor,
  label,
  score,
  action,
}: {
  color: string;
  bgColor: string;
  label: string;
  score: string;
  action: string;
}) {
  return (
    <div className="rounded-xl p-4 border" style={{ borderColor: color + '30', backgroundColor: bgColor }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-semibold" style={{ color }}>{label}</span>
      </div>
      <p className="text-sm text-slate-600 mb-1">
        คะแนน CPD: <span className="font-mono font-semibold">{score}</span>
      </p>
      <p className="text-sm text-slate-500">{action}</p>
    </div>
  );
}

function StepItem({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-600 text-white font-bold">
        {step}
      </div>
      <div>
        <h4 className="font-semibold text-slate-700">{title}</h4>
        <p className="text-sm text-slate-500 mt-1">{description}</p>
      </div>
    </div>
  );
}

function CodeBlock({ title, children }: { title?: string; children: string }) {
  return (
    <div className="rounded-xl overflow-hidden border border-slate-200">
      {title && (
        <div className="bg-slate-800 px-4 py-2 text-xs text-slate-400 font-mono flex items-center gap-2">
          <FileJson size={14} />
          {title}
        </div>
      )}
      <pre className="bg-slate-900 text-slate-200 p-4 text-sm font-mono overflow-x-auto leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function EndpointBadge({ method, path }: { method: string; path: string }) {
  const colors: Record<string, string> = {
    POST: 'bg-green-100 text-green-700 border-green-200',
    GET: 'bg-blue-100 text-blue-700 border-blue-200',
    DELETE: 'bg-red-100 text-red-700 border-red-200',
  };
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-sm">
      <span className={`rounded px-2 py-0.5 text-xs font-bold border ${colors[method] ?? ''}`}>
        {method}
      </span>
      <span className="text-slate-700">{path}</span>
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft size={16} /> กลับหน้าเข้าสู่ระบบ
          </Link>

          <div className="flex items-center gap-4 mb-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
              <Building2 className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">SR-LRMS</h1>
              <p className="text-slate-400">Surin Labor Room Monitoring System</p>
            </div>
          </div>

          <h2 className="text-4xl font-bold leading-tight mb-4">
            ระบบติดตามการคลอด
            <br />
            แบบรวมศูนย์ จังหวัดสุรินทร์
          </h2>
          <p className="text-lg text-slate-300 max-w-2xl leading-relaxed">
            ระบบ Real-time สำหรับสูติแพทย์และพยาบาลห้องคลอด ใช้ติดตามและประเมินความเสี่ยง
            ผู้คลอดในโรงพยาบาลชุมชนทั่วจังหวัดสุรินทร์ จากศูนย์กลางที่ รพ.สุรินทร์
          </p>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 py-12 space-y-16">
        {/* --- Section: ภาพรวม --- */}
        <section>
          <SectionTitle>
            <Activity className="h-6 w-6 text-teal-600" />
            ภาพรวมระบบ
          </SectionTitle>
          <div className="rounded-2xl bg-white p-8 shadow-sm space-y-6">
            <p className="text-slate-600 leading-relaxed text-lg">
              <strong>SR-LRMS</strong> (Surin Labor Room Monitoring System) คือระบบติดตามการคลอดแบบรวมศูนย์
              ระดับจังหวัด ที่ออกแบบมาเพื่อให้สูติแพทย์และพยาบาลห้องคลอดของ<strong>โรงพยาบาลแม่ข่าย</strong>
              (รพ.สุรินทร์) สามารถ<strong>ติดตามผู้คลอด</strong>ที่รอคลอดใน
              <strong>โรงพยาบาลชุมชน (รพช.) ทุกแห่ง</strong>ในจังหวัดสุรินทร์ได้แบบ Real-time
            </p>
            <p className="text-slate-600 leading-relaxed">
              ระบบดึงข้อมูลอัตโนมัติจาก <strong>HOSxP HIS</strong> (ระบบสารสนเทศโรงพยาบาล)
              ที่ใช้งานอยู่ใน รพช. ทุกแห่ง ผ่าน <strong>BMS Central API</strong> ซึ่งทำหน้าที่เป็นตัวกลางเชื่อมต่อข้อมูล
              ทำให้เจ้าหน้าที่ <strong>ไม่ต้องบันทึกข้อมูลซ้ำ</strong> — ข้อมูลที่บันทึกใน HOSxP จะไหลเข้ามาที่
              SR-LRMS โดยอัตโนมัติภายใน 30 วินาที
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
              <div className="text-center p-4 bg-teal-50 rounded-xl">
                <div className="text-3xl font-bold text-teal-700 font-mono">26</div>
                <div className="text-sm text-teal-600 mt-1">โรงพยาบาลในเครือข่าย</div>
              </div>
              <div className="text-center p-4 bg-blue-50 rounded-xl">
                <div className="text-3xl font-bold text-blue-700 font-mono">30</div>
                <div className="text-sm text-blue-600 mt-1">วินาที อัปเดตข้อมูล</div>
              </div>
              <div className="text-center p-4 bg-amber-50 rounded-xl">
                <div className="text-3xl font-bold text-amber-700 font-mono">8</div>
                <div className="text-sm text-amber-600 mt-1">ปัจจัยเสี่ยง CPD</div>
              </div>
              <div className="text-center p-4 bg-rose-50 rounded-xl">
                <div className="text-3xl font-bold text-rose-700 font-mono">24/7</div>
                <div className="text-sm text-rose-600 mt-1">ติดตามตลอดเวลา</div>
              </div>
            </div>
          </div>
        </section>

        {/* --- Section: วัตถุประสงค์ --- */}
        <section>
          <SectionTitle>
            <Shield className="h-6 w-6 text-teal-600" />
            วัตถุประสงค์
          </SectionTitle>
          <div className="rounded-2xl bg-white p-8 shadow-sm">
            <div className="space-y-5">
              <StepItem
                step={1}
                title="เพิ่มความปลอดภัยในการคลอด"
                description="ติดตามความเสี่ยง CPD (Cephalopelvic Disproportion — ภาวะศีรษะทารกไม่สมดุลกับช่องเชิงกรานมารดา) แบบ Real-time คำนวณคะแนนอัตโนมัติจาก 8 ปัจจัยเสี่ยง เพื่อให้ทีมแพทย์ตัดสินใจได้รวดเร็ว"
              />
              <StepItem
                step={2}
                title="สร้างมาตรฐานการส่งต่อผู้ป่วย"
                description="ระบบแนะนำการส่งต่อตาม MOU ของเขตสุขภาพที่ 9 ผู้คลอดที่มีความเสี่ยงสูงจะได้รับคำแนะนำให้ประสานส่งต่อไปยังโรงพยาบาลแม่ข่ายทันที"
              />
              <StepItem
                step={3}
                title="ลดอัตราการเสียชีวิตและภาวะแทรกซ้อนจากการคลอด"
                description="เมื่อสูติแพทย์เห็นข้อมูลผู้คลอดทุกแห่งในเวลาเดียวกัน สามารถให้คำแนะนำ ประเมินสถานการณ์ และตัดสินใจส่งต่อได้ก่อนที่จะเกิดภาวะแทรกซ้อน"
              />
              <StepItem
                step={4}
                title="ลดภาระการบันทึกข้อมูลซ้ำ"
                description="ข้อมูลที่เจ้าหน้าที่ รพช. บันทึกใน HOSxP จะถูกดึงมาแสดงใน SR-LRMS โดยอัตโนมัติ ไม่ต้องพิมพ์ข้อมูลซ้ำอีกครั้ง ประหยัดเวลาและลดความผิดพลาดจากการคัดลอกข้อมูล"
              />
            </div>
          </div>
        </section>

        {/* --- Section: ฟีเจอร์หลัก --- */}
        <section>
          <SectionTitle>
            <BarChart3 className="h-6 w-6 text-teal-600" />
            ฟีเจอร์หลักของระบบ
          </SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <FeatureCard
              icon={<HeartPulse className="h-6 w-6" />}
              title="Dashboard แบบ Real-time"
              description="แสดงภาพรวมผู้คลอดทั้งจังหวัด จำแนกตามระดับความเสี่ยง (สูง/ปานกลาง/ต่ำ) แสดงสถานะการเชื่อมต่อของแต่ละ รพ. และแจ้งเตือนเมื่อมีผู้คลอดเสี่ยงสูง อัปเดตข้อมูลทุก 30 วินาที"
            />
            <FeatureCard
              icon={<AlertTriangle className="h-6 w-6" />}
              title="CPD Risk Score อัตโนมัติ"
              description="คำนวณคะแนนความเสี่ยง CPD จาก 8 ปัจจัย ได้แก่ จำนวนครรภ์ จำนวนฝากครรภ์ อายุครรภ์ ส่วนสูง ส่วนต่างน้ำหนัก ยอดมดลูก น้ำหนักเด็กจาก U/S และค่า Hematocrit แสดงกราฟวิเคราะห์ว่าปัจจัยใดส่งผลมากที่สุด"
            />
            <FeatureCard
              icon={<Activity className="h-6 w-6" />}
              title="Partogram ติดตามการคลอด"
              description="แสดงกราฟ Partogram แสดงความก้าวหน้าการขยายปากมดลูก เทียบกับเส้นเตือน (Alert Line) และเส้นปฏิบัติ (Action Line) พร้อมแสดงอัตราการขยาย (ซม./ชม.) และระยะการคลอดปัจจุบัน"
            />
            <FeatureCard
              icon={<Stethoscope className="h-6 w-6" />}
              title="สัญญาณชีพแบบครบถ้วน"
              description="แสดงสัญญาณชีพปัจจุบันพร้อมสถานะ (ปกติ/เฝ้าระวัง/ผิดปกติ): ชีพจรมารดา (Maternal HR) ชีพจรทารก (Fetal HR) ความดันโลหิต (BP) และปริมาณเลือดออก (PPH) พร้อม Sparkline แนวโน้มย้อนหลัง"
            />
            <FeatureCard
              icon={<Network className="h-6 w-6" />}
              title="เชื่อมต่อ 22 โรงพยาบาล"
              description="ครอบคลุมโรงพยาบาลชุมชนทุกระดับในจังหวัดสุรินทร์ ตั้งแต่ระดับ A (S) จนถึง F3 แสดงสถานะเชื่อมต่อ (ออนไลน์/ออฟไลน์) และเวลาอัปเดตข้อมูลล่าสุดของแต่ละ รพ."
            />
            <FeatureCard
              icon={<Bell className="h-6 w-6" />}
              title="แจ้งเตือนผู้คลอดเสี่ยงสูง"
              description="เมื่อผู้คลอดมีคะแนน CPD ถึงระดับเสี่ยงสูง (≥10 คะแนน) ระบบจะแจ้งเตือนทันที พร้อมคำแนะนำให้ประสานส่งต่อ แสดงแบนเนอร์คำแนะนำการส่งต่อตามระดับความเสี่ยง"
            />
            <FeatureCard
              icon={<Baby className="h-6 w-6" />}
              title="ข้อมูลทางคลินิกครบถ้วน"
              description="แสดงข้อมูลทางคลินิกที่จำเป็นสำหรับการดูแลผู้คลอด: Gravida อายุครรภ์ ANC ส่วนสูง น้ำหนัก ยอดมดลูก น้ำหนักเด็ก Hematocrit พร้อมแสดงค่าผิดปกติด้วยสี"
            />
            <FeatureCard
              icon={<Printer className="h-6 w-6" />}
              title="พิมพ์บันทึกการคลอด"
              description="สามารถพิมพ์บันทึกการคลอดในรูปแบบ A4 ได้ทันที แสดงข้อมูลผู้คลอด สัญญาณชีพ และข้อมูลทางคลินิก พร้อมตารางบันทึก V/S สำหรับใช้เป็นเอกสารประกอบ"
            />
          </div>
        </section>

        {/* --- Section: CPD Risk Score --- */}
        <section>
          <SectionTitle>
            <AlertTriangle className="h-6 w-6 text-teal-600" />
            ระบบประเมินความเสี่ยง CPD
          </SectionTitle>
          <div className="rounded-2xl bg-white p-8 shadow-sm space-y-6">
            <p className="text-slate-600 leading-relaxed">
              <strong>CPD (Cephalopelvic Disproportion)</strong> คือภาวะที่ศีรษะทารกไม่สามารถผ่านช่องเชิงกราน
              ของมารดาได้ เป็นสาเหตุสำคัญของการคลอดยาก ระบบ SR-LRMS คำนวณคะแนนความเสี่ยง CPD
              อัตโนมัติจาก <strong>8 ปัจจัย</strong> ดังนี้:
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    <th className="py-3 pr-4 text-sm font-semibold text-slate-700">ปัจจัย</th>
                    <th className="py-3 pr-4 text-sm font-semibold text-slate-700">เกณฑ์ที่เพิ่มความเสี่ยง</th>
                    <th className="py-3 text-sm font-semibold text-slate-700">คะแนนสูงสุด</th>
                  </tr>
                </thead>
                <tbody className="text-sm text-slate-600">
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium">จำนวนครรภ์ (Gravida)</td>
                    <td className="py-3 pr-4">ท้องแรก (Primigravida)</td>
                    <td className="py-3 font-mono font-semibold">2 คะแนน</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium">จำนวน ANC</td>
                    <td className="py-3 pr-4">ฝากครรภ์น้อยกว่า 4 ครั้ง</td>
                    <td className="py-3 font-mono font-semibold">1.5 คะแนน</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium">อายุครรภ์ (GA)</td>
                    <td className="py-3 pr-4">ตั้งแต่ 40 สัปดาห์ขึ้นไป</td>
                    <td className="py-3 font-mono font-semibold">1.5 คะแนน</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium">ส่วนสูงมารดา</td>
                    <td className="py-3 pr-4">น้อยกว่า 150 ซม. (2 คะแนน) หรือ 150-155 ซม. (1 คะแนน)</td>
                    <td className="py-3 font-mono font-semibold">2 คะแนน</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium">ส่วนต่างน้ำหนัก</td>
                    <td className="py-3 pr-4">มากกว่า 20 กก. (2 คะแนน) หรือ 15-20 กก. (1 คะแนน)</td>
                    <td className="py-3 font-mono font-semibold">2 คะแนน</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium">ยอดมดลูก</td>
                    <td className="py-3 pr-4">มากกว่า 36 ซม. (2 คะแนน) หรือ 34-36 ซม. (1 คะแนน)</td>
                    <td className="py-3 font-mono font-semibold">2 คะแนน</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium">น้ำหนักเด็ก (U/S)</td>
                    <td className="py-3 pr-4">มากกว่า 3,500 กรัม (2 คะแนน) หรือ 3,000-3,500 กรัม (1 คะแนน)</td>
                    <td className="py-3 font-mono font-semibold">2 คะแนน</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">Hematocrit</td>
                    <td className="py-3 pr-4">น้อยกว่า 30%</td>
                    <td className="py-3 font-mono font-semibold">1.5 คะแนน</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-lg font-semibold text-slate-700 pt-4">ระดับความเสี่ยง</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <RiskLevelCard
                color="#22c55e"
                bgColor="#dcfce7"
                label="เสี่ยงต่ำ"
                score="0 — 4.99"
                action="ติดตามปกติ ดูแลตามแนวทางมาตรฐาน"
              />
              <RiskLevelCard
                color="#eab308"
                bgColor="#fef9c3"
                label="เสี่ยงปานกลาง"
                score="5 — 9.99"
                action="เฝ้าระวังใกล้ชิด เตรียมพร้อมส่งต่อ"
              />
              <RiskLevelCard
                color="#ef4444"
                bgColor="#fee2e2"
                label="เสี่ยงสูง"
                score="10 ขึ้นไป"
                action="ควรประสานส่งต่อไปยัง รพ.แม่ข่ายทันที!"
              />
            </div>
          </div>
        </section>

        {/* --- Section: โครงสร้างเครือข่าย --- */}
        <section>
          <SectionTitle>
            <Network className="h-6 w-6 text-teal-600" />
            โครงสร้างเครือข่ายโรงพยาบาล
          </SectionTitle>
          <div className="rounded-2xl bg-white p-8 shadow-sm space-y-6">
            <p className="text-slate-600 leading-relaxed">
              ระบบ SR-LRMS ใช้โมเดล <strong>Hub-and-Spoke</strong> โดยมี รพ.สุรินทร์ เป็นศูนย์กลาง (Hub)
              เชื่อมต่อกับ รพช. ทุกระดับในจังหวัดสุรินทร์:
            </p>
            <div className="space-y-1">
              <HospitalLevelRow
                level="Hub"
                name="รพ.สุรินทร์"
                description="โรงพยาบาลศูนย์ — ศูนย์กลาง SR-LRMS สูติแพทย์และพยาบาลห้องคลอดใช้ Monitor ผู้คลอดจากทุก รพ."
              />
              <HospitalLevelRow
                level="A (S)"
                name="รพช.ขนาดใหญ่"
                description="เช่น รพ.ชุมแพ รพ.พล รพ.บ้านไผ่ รพ.น้ำพอง — มีสูติแพทย์ประจำ สามารถผ่าตัดคลอดได้"
              />
              <HospitalLevelRow
                level="M1"
                name="รพช.ขนาดกลาง"
                description="โรงพยาบาลชุมชนขนาดกลาง มีพยาบาลห้องคลอดประจำ"
              />
              <HospitalLevelRow
                level="M2"
                name="รพช.ขนาดกลาง-เล็ก"
                description="โรงพยาบาลชุมชนขนาดกลาง-เล็ก รองรับการคลอดปกติ"
              />
              <HospitalLevelRow
                level="F1"
                name="รพช.ขนาดเล็กระดับ 1"
                description="โรงพยาบาลชุมชนขนาดเล็ก รองรับการคลอดปกติ"
              />
              <HospitalLevelRow
                level="F2"
                name="รพช.ขนาดเล็กระดับ 2"
                description="โรงพยาบาลชุมชนขนาดเล็ก รองรับการคลอดเบื้องต้น"
              />
              <HospitalLevelRow
                level="F3"
                name="รพช.ขนาดเล็กระดับ 3 / รพ.สต."
                description="โรงพยาบาลขนาดเล็กที่สุด ส่งต่อกรณีที่มีความเสี่ยง"
              />
            </div>
          </div>
        </section>

        {/* --- Section: การทำงานของระบบ --- */}
        <section>
          <SectionTitle>
            <Clock className="h-6 w-6 text-teal-600" />
            ขั้นตอนการทำงานของระบบ
          </SectionTitle>
          <div className="rounded-2xl bg-white p-8 shadow-sm">
            <div className="space-y-8">
              <StepItem
                step={1}
                title="เจ้าหน้าที่ รพช. บันทึกข้อมูลใน HOSxP"
                description="พยาบาลห้องคลอดที่ รพช. บันทึกข้อมูลผู้คลอดตามปกติใน HOSxP HIS (ระบบสารสนเทศที่ใช้อยู่เดิม) ทั้งข้อมูลทั่วไป สัญญาณชีพ การตรวจภายใน และอื่นๆ"
              />
              <div className="flex justify-center">
                <ChevronRight className="h-6 w-6 text-slate-300 rotate-90" />
              </div>
              <StepItem
                step={2}
                title="BMS Central API ดึงข้อมูลจาก HOSxP"
                description="BMS Central API (ตัวกลางเชื่อมต่อข้อมูล) จะเชื่อมต่อกับฐานข้อมูล HOSxP ของแต่ละ รพช. โดยอัตโนมัติ ดึงข้อมูลผู้คลอดที่กำลังรอคลอด (Active Labor) ออกมา"
              />
              <div className="flex justify-center">
                <ChevronRight className="h-6 w-6 text-slate-300 rotate-90" />
              </div>
              <StepItem
                step={3}
                title="SR-LRMS ประมวลผลและแสดงข้อมูล"
                description="ระบบ SR-LRMS รับข้อมูลจาก BMS API คำนวณ CPD Risk Score อัตโนมัติจาก 8 ปัจจัยเสี่ยง สร้าง Partogram และแสดงบน Dashboard กลาง โดยอัปเดตทุก 30 วินาที"
              />
              <div className="flex justify-center">
                <ChevronRight className="h-6 w-6 text-slate-300 rotate-90" />
              </div>
              <StepItem
                step={4}
                title="สูติแพทย์ติดตามและให้คำแนะนำ"
                description="สูติแพทย์ที่ รพ.สุรินทร์ เปิด Dashboard ดูผู้คลอดทั้งจังหวัด หากพบผู้คลอดเสี่ยงสูง สามารถประสานงานส่งต่อ ให้คำแนะนำ หรือเตรียมรับผู้ป่วยได้ทันที"
              />
            </div>
          </div>
        </section>

        {/* --- Section: Webhook & API --- */}
        <section>
          <SectionTitle>
            <Webhook className="h-6 w-6 text-teal-600" />
            Webhook &amp; API สำหรับโรงพยาบาลภายนอก
          </SectionTitle>
          <div className="rounded-2xl bg-white p-8 shadow-sm space-y-8">
            {/* Overview */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Globe className="h-6 w-6 shrink-0 text-teal-500 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold text-slate-700 mb-2">ภาพรวม</h3>
                  <p className="text-slate-600 leading-relaxed">
                    สำหรับ<strong>โรงพยาบาลที่ไม่ได้ใช้ HOSxP</strong> (เช่น รพ.เอกชน หรือ รพ.ที่ใช้ HIS อื่น)
                    สามารถส่งข้อมูลผู้คลอดเข้าระบบ SR-LRMS ได้ผ่าน <strong>Webhook API</strong> โดยตรง
                    ข้อมูลจะถูกประมวลผลเหมือนกันทุกประการ — คำนวณ CPD Score, ตรวจจับการส่งต่อ,
                    แจ้งเตือนความเสี่ยงสูง, และแสดงบน Dashboard แบบ Real-time
                  </p>
                </div>
              </div>
            </div>

            {/* Authentication */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5 text-teal-600" />
                <h3 className="text-lg font-semibold text-slate-700">การยืนยันตัวตน (Authentication)</h3>
              </div>
              <p className="text-slate-600 leading-relaxed">
                ใช้ <strong>Bearer Token</strong> ผ่าน HTTP Header ทุกโรงพยาบาลจะได้รับ API Key เฉพาะ
                ที่ออกให้โดยผู้ดูแลระบบ สสจ.สุรินทร์ API Key จะแสดงเพียงครั้งเดียวตอนสร้าง — กรุณาบันทึกไว้ให้ดี
              </p>
              <CodeBlock title="HTTP Header">
{`Authorization: Bearer kklrms_a1b2c3d4e5f6...`}
              </CodeBlock>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-400 mb-1">รูปแบบ API Key</div>
                  <div className="font-mono text-sm text-slate-700">kklrms_ + 40 hex chars</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-400 mb-1">การเก็บรักษา</div>
                  <div className="text-sm text-slate-700">SHA-256 Hash (ปลอดภัย)</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-400 mb-1">การเพิกถอน</div>
                  <div className="text-sm text-slate-700">ยกเลิกได้ทันทีโดย Admin</div>
                </div>
              </div>
            </div>

            {/* Endpoint: Patient Data */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Send className="h-5 w-5 text-teal-600" />
                <h3 className="text-lg font-semibold text-slate-700">Endpoint: ส่งข้อมูลผู้คลอด</h3>
              </div>
              <EndpointBadge method="POST" path="/api/webhooks/patient-data" />
              <p className="text-slate-600">
                ส่งข้อมูลผู้คลอดเข้าระบบ รองรับสูงสุด <strong>100 ราย</strong> ต่อ request
                ระบบจะ upsert (สร้างใหม่หรืออัปเดต) โดยอิงจากเลข AN รองรับ 2 โหมด:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div className="font-semibold text-blue-800 mb-1 font-mono text-sm">&quot;mode&quot;: &quot;incremental&quot;</div>
                  <p className="text-sm text-blue-700">
                    <strong>(ค่าเริ่มต้น)</strong> เพิ่ม/อัปเดตเฉพาะผู้คลอดที่ส่งมา ผู้คลอดที่ไม่ได้ส่งจะยังคงสถานะเดิม
                    เหมาะสำหรับส่งข้อมูลเฉพาะรายที่มีการเปลี่ยนแปลง
                  </p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <div className="font-semibold text-amber-800 mb-1 font-mono text-sm">&quot;mode&quot;: &quot;full_snapshot&quot;</div>
                  <p className="text-sm text-amber-700">
                    <strong>ส่งรายชื่อทั้งหมด</strong> — ผู้คลอดที่อยู่ในระบบแต่ไม่อยู่ใน payload จะถูกเปลี่ยนสถานะเป็น
                    DELIVERED อัตโนมัติ เหมาะสำหรับระบบที่ส่งข้อมูลเป็นรอบ (เช่น ทุก 5 นาที)
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Request */}
                <div>
                  <h4 className="text-sm font-semibold text-slate-600 mb-2">Request Body (JSON)</h4>
                  <CodeBlock title="request.json">
{`{
  "mode": "full_snapshot",
  "patients": [
    {
      "hn": "HN-001",
      "an": "AN-001",
      "name": "นาง ทดสอบ ระบบ",
      "cid": "1100500012345",
      "age": 28,
      "gravida": 1,
      "ga_weeks": 41,
      "anc_count": 3,
      "admit_date": "2026-03-08T08:00:00+07:00",
      "height_cm": 148,
      "weight_kg": 75,
      "weight_diff_kg": 20,
      "fundal_height_cm": 37,
      "us_weight_g": 4000,
      "hematocrit_pct": 29,
      "labor_status": "ACTIVE"
    }
  ]
}`}
                  </CodeBlock>
                </div>

                {/* Response */}
                <div>
                  <h4 className="text-sm font-semibold text-slate-600 mb-2">Response (200 OK)</h4>
                  <CodeBlock title="response.json">
{`{
  "success": true,
  "patientsProcessed": 1,
  "newAdmissions": 1,
  "discharges": 0,
  "transfers": 0,
  "timestamp": "2026-03-08T08:00:05Z"
}`}
                  </CodeBlock>
                  <div className="mt-4">
                    <h4 className="text-sm font-semibold text-slate-600 mb-2">Response Fields</h4>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex gap-2">
                        <code className="text-teal-700 font-mono shrink-0">patientsProcessed</code>
                        <span className="text-slate-500">— จำนวนผู้คลอดที่ประมวลผลสำเร็จ</span>
                      </div>
                      <div className="flex gap-2">
                        <code className="text-teal-700 font-mono shrink-0">newAdmissions</code>
                        <span className="text-slate-500">— จำนวนผู้คลอดรายใหม่ (ไม่เคยอยู่ในระบบ)</span>
                      </div>
                      <div className="flex gap-2">
                        <code className="text-teal-700 font-mono shrink-0">discharges</code>
                        <span className="text-slate-500">— จำนวนที่ถูกเปลี่ยนเป็น DELIVERED (เฉพาะ full_snapshot mode)</span>
                      </div>
                      <div className="flex gap-2">
                        <code className="text-teal-700 font-mono shrink-0">transfers</code>
                        <span className="text-slate-500">— จำนวนที่ตรวจพบว่าเป็นการย้าย รพ.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Fields Table */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-slate-700">รายละเอียด Fields ข้อมูลผู้คลอด</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-200">
                      <th className="py-2.5 pr-3 font-semibold text-slate-700">Field</th>
                      <th className="py-2.5 pr-3 font-semibold text-slate-700">Type</th>
                      <th className="py-2.5 pr-3 font-semibold text-slate-700">จำเป็น</th>
                      <th className="py-2.5 font-semibold text-slate-700">คำอธิบาย</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-600">
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-teal-700">hn</td>
                      <td className="py-2.5 pr-3">string</td>
                      <td className="py-2.5 pr-3"><CheckCircle2 size={16} className="text-green-500" /></td>
                      <td className="py-2.5">เลข HN (Hospital Number)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-teal-700">an</td>
                      <td className="py-2.5 pr-3">string</td>
                      <td className="py-2.5 pr-3"><CheckCircle2 size={16} className="text-green-500" /></td>
                      <td className="py-2.5">เลข AN (Admission Number) — ใช้เป็น primary key</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-teal-700">name</td>
                      <td className="py-2.5 pr-3">string</td>
                      <td className="py-2.5 pr-3"><CheckCircle2 size={16} className="text-green-500" /></td>
                      <td className="py-2.5">ชื่อ-สกุลผู้คลอด (เข้ารหัสอัตโนมัติ ตาม PDPA)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-teal-700">age</td>
                      <td className="py-2.5 pr-3">number</td>
                      <td className="py-2.5 pr-3"><CheckCircle2 size={16} className="text-green-500" /></td>
                      <td className="py-2.5">อายุมารดา (ปี)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-teal-700">admit_date</td>
                      <td className="py-2.5 pr-3">string</td>
                      <td className="py-2.5 pr-3"><CheckCircle2 size={16} className="text-green-500" /></td>
                      <td className="py-2.5">วันเวลา Admit (ISO 8601 เช่น 2026-03-08T08:00:00+07:00)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-slate-500">cid</td>
                      <td className="py-2.5 pr-3">string</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">เลขบัตรประชาชน 13 หลัก (เข้ารหัส+Hash สำหรับตรวจจับการย้าย รพ.)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-slate-500">gravida</td>
                      <td className="py-2.5 pr-3">number</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">จำนวนครรภ์ (ปัจจัย CPD)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-slate-500">ga_weeks</td>
                      <td className="py-2.5 pr-3">number</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">อายุครรภ์ (สัปดาห์) (ปัจจัย CPD)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-slate-500">anc_count</td>
                      <td className="py-2.5 pr-3">number</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">จำนวนครั้งที่ฝากครรภ์ (ปัจจัย CPD)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-slate-500">height_cm</td>
                      <td className="py-2.5 pr-3">number</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">ส่วนสูง (ซม.) (ปัจจัย CPD)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-slate-500">weight_kg</td>
                      <td className="py-2.5 pr-3">number</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">น้ำหนักมารดาปัจจุบัน (กก.)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-slate-500">weight_diff_kg</td>
                      <td className="py-2.5 pr-3">number</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">ส่วนต่างน้ำหนัก (กก.) (ปัจจัย CPD)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-slate-500">fundal_height_cm</td>
                      <td className="py-2.5 pr-3">number</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">ยอดมดลูก (ซม.) (ปัจจัย CPD)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-slate-500">us_weight_g</td>
                      <td className="py-2.5 pr-3">number</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">น้ำหนักเด็กจาก U/S (กรัม) (ปัจจัย CPD)</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2.5 pr-3 font-mono text-slate-500">hematocrit_pct</td>
                      <td className="py-2.5 pr-3">number</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">ค่า Hematocrit (%) (ปัจจัย CPD)</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-3 font-mono text-slate-500">labor_status</td>
                      <td className="py-2.5 pr-3">string</td>
                      <td className="py-2.5 pr-3"><XCircle size={16} className="text-slate-300" /></td>
                      <td className="py-2.5">สถานะ: <code className="bg-slate-100 px-1 rounded">ACTIVE</code> (ค่าเริ่มต้น) หรือ <code className="bg-slate-100 px-1 rounded">DELIVERED</code></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-slate-400">
                หมายเหตุ: ยิ่งส่งข้อมูล optional fields (ปัจจัย CPD) ครบถ้วน คะแนน CPD Risk Score จะแม่นยำยิ่งขึ้น
                ปัจจัยที่ไม่ได้ส่งจะแสดงเป็น &ldquo;ข้อมูลไม่ครบ&rdquo; ในหน้ารายละเอียดผู้คลอด
              </p>

              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 mt-4">
                <h4 className="font-semibold text-amber-800 text-sm mb-2">ข้อแนะนำ: เลือกโหมดที่เหมาะสม</h4>
                <ul className="text-sm text-amber-700 space-y-1.5 list-disc list-inside">
                  <li><strong>full_snapshot</strong> — ใช้เมื่อระบบ HIS ส่งรายชื่อผู้คลอดทั้งหมดเป็นรอบ (ทุก 5-30 นาที) ผู้คลอดที่จำหน่ายแล้วจะหายจาก payload โดยอัตโนมัติ ระบบจะเปลี่ยนสถานะเป็น DELIVERED ให้</li>
                  <li><strong>incremental</strong> — ใช้เมื่อส่งข้อมูลเฉพาะรายที่มีการเปลี่ยนแปลง ต้องส่ง <code className="bg-amber-100 px-1 rounded">labor_status: &quot;DELIVERED&quot;</code> เมื่อผู้คลอดจำหน่าย มิฉะนั้นผู้คลอดจะแสดงเป็น ACTIVE ตลอด</li>
                </ul>
              </div>
            </div>

            {/* Error Codes */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-slate-700">HTTP Status Codes</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 flex gap-3">
                  <span className="shrink-0 font-mono font-bold text-green-700">200</span>
                  <span className="text-sm text-green-800">สำเร็จ — ข้อมูลถูกประมวลผลเรียบร้อย</span>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-3">
                  <span className="shrink-0 font-mono font-bold text-amber-700">400</span>
                  <span className="text-sm text-amber-800">Payload ไม่ถูกต้อง — ตรวจสอบ JSON format และ required fields</span>
                </div>
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex gap-3">
                  <span className="shrink-0 font-mono font-bold text-red-700">401</span>
                  <span className="text-sm text-red-800">ไม่ได้ยืนยันตัวตน — API Key หาย ไม่ถูกต้อง หรือถูกเพิกถอน</span>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex gap-3">
                  <span className="shrink-0 font-mono font-bold text-slate-700">500</span>
                  <span className="text-sm text-slate-800">ข้อผิดพลาดภายในระบบ — ติดต่อผู้ดูแลระบบ</span>
                </div>
              </div>
            </div>

            {/* Admin API */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Key className="h-5 w-5 text-teal-600" />
                <h3 className="text-lg font-semibold text-slate-700">Admin API — จัดการ API Keys</h3>
              </div>
              <p className="text-sm text-slate-500">
                Endpoints สำหรับผู้ดูแลระบบ (ต้องล็อกอินในระบบด้วย role ADMIN)
              </p>
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                  <EndpointBadge method="GET" path="/api/admin/webhooks" />
                  <p className="text-sm text-slate-600">แสดงรายการ API Keys ทั้งหมด พร้อมข้อมูลโรงพยาบาล สถานะ และเวลาใช้งานล่าสุด</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                  <EndpointBadge method="POST" path="/api/admin/webhooks" />
                  <p className="text-sm text-slate-600">สร้าง API Key ใหม่ ส่ง <code className="bg-slate-100 px-1 rounded text-xs">hcode</code> และ <code className="bg-slate-100 px-1 rounded text-xs">label</code> ระบบจะคืน API Key เพียงครั้งเดียว</p>
                  <CodeBlock title="request body">
{`{ "hcode": "99901", "label": "Production Key" }`}
                  </CodeBlock>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 space-y-2">
                  <EndpointBadge method="DELETE" path="/api/admin/webhooks/:keyId" />
                  <p className="text-sm text-slate-600">เพิกถอน API Key ทันที Key ที่ถูกเพิกถอนจะใช้งานไม่ได้อีก</p>
                </div>
              </div>
            </div>

            {/* cURL Example */}
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-slate-700">ตัวอย่างการเรียกใช้งาน (cURL)</h3>
              <CodeBlock title="terminal">
{`curl -X POST https://kk-lrms.example.com/api/webhooks/patient-data \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer kklrms_a1b2c3d4e5f6..." \\
  -d '{
    "mode": "full_snapshot",
    "patients": [{
      "hn": "HN-001",
      "an": "AN-001",
      "name": "นาง ทดสอบ ระบบ",
      "age": 28,
      "admit_date": "2026-03-08T08:00:00+07:00",
      "gravida": 1,
      "ga_weeks": 41,
      "height_cm": 148,
      "us_weight_g": 4000
    }]
  }'`}
              </CodeBlock>
            </div>

            {/* Data Flow Note */}
            <div className="rounded-xl bg-teal-50 border border-teal-100 p-5 space-y-3">
              <h4 className="font-semibold text-teal-800 flex items-center gap-2">
                <Activity size={18} />
                การประมวลผลหลังรับข้อมูล
              </h4>
              <ol className="text-sm text-teal-700 space-y-2 list-decimal list-inside">
                <li>เข้ารหัสชื่อ-สกุลและเลขบัตรประชาชน (AES-256-GCM ตาม PDPA)</li>
                <li>Upsert ข้อมูลผู้คลอดลงฐานข้อมูล (อิงจาก AN)</li>
                <li>ตรวจจับการย้ายโรงพยาบาลจาก CID Hash (ถ้ามี)</li>
                <li>คำนวณ CPD Risk Score อัตโนมัติจากปัจจัยที่ส่งมา</li>
                <li>แจ้งเตือนทันทีผ่าน SSE หากพบผู้คลอดเสี่ยงสูง</li>
                <li>อัปเดตสถานะโรงพยาบาลเป็น ONLINE บน Dashboard</li>
              </ol>
            </div>
          </div>
        </section>

        {/* --- Section: กลุ่มผู้ใช้ --- */}
        <section>
          <SectionTitle>
            <Users className="h-6 w-6 text-teal-600" />
            กลุ่มผู้ใช้งาน
          </SectionTitle>
          <div className="rounded-2xl bg-white p-8 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    <th className="py-3 pr-4 text-sm font-semibold text-slate-700">บทบาท</th>
                    <th className="py-3 pr-4 text-sm font-semibold text-slate-700">ตำแหน่ง</th>
                    <th className="py-3 text-sm font-semibold text-slate-700">การใช้งานหลัก</th>
                  </tr>
                </thead>
                <tbody className="text-sm text-slate-600">
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium">สูติแพทย์</td>
                    <td className="py-3 pr-4">แพทย์เฉพาะทาง รพ.สุรินทร์</td>
                    <td className="py-3">Monitor Case ให้คำแนะนำส่งต่อ ประเมินความเสี่ยง</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium">พยาบาลห้องคลอด รพ.แม่ข่าย</td>
                    <td className="py-3 pr-4">พยาบาลวิชาชีพ รพ.สุรินทร์</td>
                    <td className="py-3">ติดตาม Partogram รับแจ้งเตือน ประสานงานส่งต่อ</td>
                  </tr>
                  <tr className="border-b border-slate-100">
                    <td className="py-3 pr-4 font-medium">พยาบาล รพช.</td>
                    <td className="py-3 pr-4">พยาบาลวิชาชีพ รพช. ในจังหวัดสุรินทร์</td>
                    <td className="py-3">บันทึกข้อมูลผู้คลอดใน HOSxP อัปเดตสถานะ</td>
                  </tr>
                  <tr>
                    <td className="py-3 pr-4 font-medium">ผู้ดูแลระบบ</td>
                    <td className="py-3 pr-4">IT Admin สสจ.สุรินทร์</td>
                    <td className="py-3">ตั้งค่าการเชื่อมต่อ HOSxP จัดการสิทธิ์ผู้ใช้งาน</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* --- Section: ความปลอดภัย --- */}
        <section>
          <SectionTitle>
            <Shield className="h-6 w-6 text-teal-600" />
            ความปลอดภัยและความเป็นส่วนตัว
          </SectionTitle>
          <div className="rounded-2xl bg-white p-8 shadow-sm space-y-4">
            <p className="text-slate-600 leading-relaxed">
              ระบบ SR-LRMS ออกแบบให้เป็นไปตาม <strong>พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล (PDPA)</strong>:
            </p>
            <ul className="space-y-3 text-slate-600">
              <li className="flex gap-3">
                <Shield className="h-5 w-5 shrink-0 text-teal-500 mt-0.5" />
                <span><strong>เข้ารหัสข้อมูลส่วนบุคคล</strong> — ชื่อ-สกุลและเลขบัตรประชาชนถูกเข้ารหัส (Encrypt) ทั้งในฐานข้อมูลและระหว่างการส่งข้อมูล</span>
              </li>
              <li className="flex gap-3">
                <Shield className="h-5 w-5 shrink-0 text-teal-500 mt-0.5" />
                <span><strong>ระบบยืนยันตัวตน</strong> — ผู้ใช้ต้องลงชื่อเข้าใช้ด้วย BMS Session ID ที่ได้รับจาก สสจ.สุรินทร์ ไม่สามารถเข้าถึงข้อมูลได้โดยไม่ผ่านการยืนยันตัวตน</span>
              </li>
              <li className="flex gap-3">
                <Shield className="h-5 w-5 shrink-0 text-teal-500 mt-0.5" />
                <span><strong>บันทึกการเข้าถึง (Audit Log)</strong> — ทุกครั้งที่มีการเปิดดูข้อมูลผู้คลอด ระบบจะบันทึกว่าใครเข้าดูข้อมูลอะไร เมื่อไหร่</span>
              </li>
              <li className="flex gap-3">
                <Shield className="h-5 w-5 shrink-0 text-teal-500 mt-0.5" />
                <span><strong>ไม่แสดงชื่อผู้คลอด</strong> — หน้าจอแสดงเฉพาะเลข AN และ HN เท่านั้น ไม่แสดงชื่อ-สกุล เพื่อความเป็นส่วนตัว</span>
              </li>
              <li className="flex gap-3">
                <Shield className="h-5 w-5 shrink-0 text-teal-500 mt-0.5" />
                <span><strong>การเชื่อมต่อปลอดภัย</strong> — ใช้ HTTPS ในการเชื่อมต่อทั้งหมด พร้อม Security Headers มาตรฐาน</span>
              </li>
            </ul>
          </div>
        </section>

        {/* --- Footer --- */}
        <footer className="border-t border-slate-200 pt-8 pb-4 text-center text-sm text-slate-400 space-y-2">
          <p className="font-semibold text-slate-500">
            SR-LRMS {APP_VERSION_LABEL} — ระบบติดตามการคลอดแบบรวมศูนย์ จังหวัดสุรินทร์
          </p>
          <p>
            สำนักงานสาธารณสุขจังหวัดสุรินทร์ — เขตสุขภาพที่ 9
          </p>
          <p className="pt-4">
            <Link
              href="/login"
              className="text-teal-600 hover:text-teal-800 font-medium transition-colors"
            >
              เข้าสู่ระบบ
            </Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
