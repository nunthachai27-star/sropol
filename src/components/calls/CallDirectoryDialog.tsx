'use client';

// Multi-select directory of online users grouped by hospital. Used both to
// start a group call (TopNavBar) and to add participants mid-call (room
// page). onCall resolves to a Thai error/notice string (shown inline, dialog
// stays open) or null (done — parent navigated or list refreshed).
import { useCallback, useEffect, useState } from 'react';
import { Building2, Loader2, RefreshCw, Video } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface DirectoryCallTarget {
  userId: string;
  name: string;
  role: string;
  hospitalName: string;
}

interface DirectoryHospital {
  hospitalCode: string;
  hospitalName: string;
  users: { userId: string; name: string; role: string }[];
}

interface CallDirectoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCall: (targets: DirectoryCallTarget[]) => Promise<string | null>;
  title?: string;
  actionLabel?: string;
}

export function CallDirectoryDialog({
  open,
  onOpenChange,
  onCall,
  title = 'โทรวิดีโอระหว่างโรงพยาบาล',
  actionLabel = 'โทร',
}: CallDirectoryDialogProps) {
  const [hospitals, setHospitals] = useState<DirectoryHospital[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Map<string, DirectoryCallTarget>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/calls/directory');
      if (!res.ok) throw new Error(`directory ${res.status}`);
      const body = (await res.json()) as { hospitals: DirectoryHospital[] };
      setHospitals(body.hospitals);
    } catch {
      setHospitals(null);
      setError('ไม่สามารถโหลดรายชื่อผู้ใช้ออนไลน์ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setSelected(new Map());
      setActionError(null);
      void load();
    }
  }, [open, load]);

  const toggle = (hospital: DirectoryHospital, user: DirectoryHospital['users'][number]) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(user.userId)) {
        next.delete(user.userId);
      } else {
        next.set(user.userId, {
          userId: user.userId,
          name: user.name,
          role: user.role,
          hospitalName: hospital.hospitalName,
        });
      }
      return next;
    });
  };

  const submit = async () => {
    if (selected.size === 0 || submitting) return;
    setSubmitting(true);
    setActionError(null);
    const message = await onCall(Array.from(selected.values()));
    setSubmitting(false);
    if (message) setActionError(message);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <Video className="h-4 w-4 text-emerald-600" /> {title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between text-[12px] text-slate-500">
          <span>เลือกได้หลายคน — แสดงเฉพาะผู้ใช้ที่ออนไลน์</span>
          <button
            onClick={() => void load()}
            disabled={loading}
            aria-label="รีเฟรชรายชื่อ"
            className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> รีเฟรช
          </button>
        </div>

        {loading && !hospitals && (
          <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดรายชื่อ…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-[13px] text-red-700">
            {error}
            <button
              onClick={() => void load()}
              className="mt-2 block cursor-pointer rounded-md border border-red-300 px-3 py-1 text-[12px] font-semibold text-red-700 hover:bg-red-100"
            >
              ลองใหม่
            </button>
          </div>
        )}

        {hospitals && hospitals.length === 0 && (
          <div className="py-8 text-center text-[13px] text-slate-500">
            ไม่มีผู้ใช้ท่านอื่นออนไลน์ในขณะนี้ — ลองรีเฟรชอีกครั้งภายหลัง
          </div>
        )}

        {hospitals?.map((hospital) => (
          <div key={hospital.hospitalCode} className="rounded-md border border-slate-200">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[13px] font-semibold text-slate-700">
              <Building2 className="h-4 w-4 text-slate-400" />
              {hospital.hospitalName}
              <span className="ml-auto text-[11px] font-normal text-slate-400">
                {hospital.users.length} คนออนไลน์
              </span>
            </div>
            <ul>
              {hospital.users.map((user) => {
                const checked = selected.has(user.userId);
                return (
                  <li key={user.userId}>
                    <button
                      type="button"
                      onClick={() => toggle(hospital, user)}
                      className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors ${
                        checked ? 'bg-emerald-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        tabIndex={-1}
                        className="h-4 w-4 accent-emerald-600"
                        aria-label={`เลือก ${user.name}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-slate-900">
                          {user.name}
                        </span>
                        <span className="block text-[11px] text-slate-500">{user.role}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {actionError && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
            {actionError}
          </div>
        )}

        <button
          onClick={() => void submit()}
          disabled={selected.size === 0 || submitting}
          className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Video className="h-4 w-4" />
          )}
          {actionLabel} ({selected.size})
        </button>
      </DialogContent>
    </Dialog>
  );
}
