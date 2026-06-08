// T081: PrintForm — A4 print-optimized labor record form
'use client';

import type { VitalSignEntry } from '@/types/api';

interface PrintFormProps {
  patient: {
    hn: string;
    an: string;
    name: string;
    age: number;
    gravida: number | null;
    gaWeeks: number | null;
    admitDate: string;
  };
  hospitalName: string;
  vitals: VitalSignEntry[];
}

export function PrintForm({ patient, hospitalName, vitals }: PrintFormProps) {
  return (
    <div className="print-form p-8 font-sans text-sm">
      <style>{`
        @media print {
          .print-form { page-break-inside: avoid; }
          @page { size: A4; margin: 1.5cm; }
        }
      `}</style>

      {/* Header */}
      <div className="mb-4 border-b pb-4 text-center">
        <h1 className="text-lg font-bold">{hospitalName}</h1>
        <h2 className="text-base font-semibold">บันทึกการคลอด (Labor Record)</h2>
      </div>

      {/* Patient Info */}
      <div className="mb-4 grid grid-cols-3 gap-2 text-sm">
        <div>HN: <strong>{patient.hn}</strong></div>
        <div>AN: <strong>{patient.an}</strong></div>
        <div>อายุ: <strong>{patient.age} ปี</strong></div>
        <div>ครรภ์ที่: <strong>{patient.gravida ?? '-'}</strong></div>
        <div>GA: <strong>{patient.gaWeeks ? `${patient.gaWeeks} สัปดาห์` : '-'}</strong></div>
        <div>วัน Admit: <strong>
          {new Date(patient.admitDate).toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </strong></div>
      </div>

      {/* Vital Signs Table */}
      <table className="w-full border-collapse border text-xs">
        <thead>
          <tr className="bg-gray-100">
            <th className="border px-2 py-1">วันเวลา</th>
            <th className="border px-2 py-1">V/S</th>
            <th className="border px-2 py-1">UC</th>
            <th className="border px-2 py-1">FHS</th>
            <th className="border px-2 py-1">Cervix</th>
            <th className="border px-2 py-1">ผู้ตรวจ</th>
            <th className="border px-2 py-1">SOS</th>
            <th className="border px-2 py-1">Med</th>
            <th className="border px-2 py-1">หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          {vitals.length > 0 ? (
            vitals.map((v, i) => (
              <tr key={i}>
                <td className="border px-2 py-1">
                  {new Date(v.measuredAt).toLocaleString('th-TH', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="border px-2 py-1">
                  {v.sbp && v.dbp ? `${v.sbp}/${v.dbp}` : '-'}{' '}
                  {v.maternalHr ? `HR ${v.maternalHr}` : ''}
                </td>
                <td className="border px-2 py-1">-</td>
                <td className="border px-2 py-1">{v.fetalHr ?? '-'}</td>
                <td className="border px-2 py-1">-</td>
                <td className="border px-2 py-1"></td>
                <td className="border px-2 py-1"></td>
                <td className="border px-2 py-1"></td>
                <td className="border px-2 py-1">{v.pphAmountMl ? `PPH ${v.pphAmountMl}ml` : ''}</td>
              </tr>
            ))
          ) : (
            // Empty rows for manual filling
            Array.from({ length: 12 }).map((_, i) => (
              <tr key={i}>
                <td className="border px-2 py-1 h-8"></td>
                <td className="border px-2 py-1"></td>
                <td className="border px-2 py-1"></td>
                <td className="border px-2 py-1"></td>
                <td className="border px-2 py-1"></td>
                <td className="border px-2 py-1"></td>
                <td className="border px-2 py-1"></td>
                <td className="border px-2 py-1"></td>
                <td className="border px-2 py-1"></td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Footer */}
      <div className="mt-6 text-right text-xs text-gray-400">
        พิมพ์จาก SR-LRMS เมื่อ {new Date().toLocaleString('th-TH')}
      </div>
    </div>
  );
}
