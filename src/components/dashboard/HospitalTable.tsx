// T055: HospitalTable — sortable table of hospitals with risk counts
// T106: Row highlight animation when risk counts change
'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ConnectionStatus } from '@/components/shared/ConnectionStatus';
import type { DashboardHospital } from '@/types/api';
import { ConnectionStatus as ConnectionStatusEnum } from '@/types/domain';

interface HospitalTableProps {
  hospitals: DashboardHospital[];
}

interface HospitalCounts {
  low: number;
  medium: number;
  high: number;
  total: number;
}

type SortKey = 'name' | 'level' | 'low' | 'medium' | 'high' | 'total';
type SortDir = 'asc' | 'desc';

function SortableHeader({
  label,
  sortKey: currentSortKey,
  sortDir,
  columnKey,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sortDir: SortDir;
  columnKey: SortKey;
  onSort: (key: SortKey) => void;
}) {
  return (
    <TableHead
      className="cursor-pointer select-none hover:bg-muted/50"
      onClick={() => onSort(columnKey)}
    >
      {label} {currentSortKey === columnKey ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </TableHead>
  );
}

export function HospitalTable({ hospitals }: HospitalTableProps) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const prevCountsRef = useRef<Map<string, HospitalCounts>>(new Map());
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  // T106: Detect changed rows by comparing current counts with previous
  useEffect(() => {
    const prevCounts = prevCountsRef.current;

    for (const h of hospitals) {
      const prev = prevCounts.get(h.hcode);
      if (prev && (
        prev.low !== h.counts.low ||
        prev.medium !== h.counts.medium ||
        prev.high !== h.counts.high ||
        prev.total !== h.counts.total
      )) {
        const el = rowRefs.current.get(h.hcode);
        if (el) {
          el.classList.add('animate-highlight');
          setTimeout(() => el.classList.remove('animate-highlight'), 2000);
        }
      }
    }

    // Update previous counts ref
    const nextCounts = new Map<string, HospitalCounts>();
    for (const h of hospitals) {
      nextCounts.set(h.hcode, { ...h.counts });
    }
    prevCountsRef.current = nextCounts;
  }, [hospitals]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => [...hospitals].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'name':
        return a.name.localeCompare(b.name, 'th') * dir;
      case 'level':
        return a.level.localeCompare(b.level) * dir;
      case 'low':
        return (a.counts.low - b.counts.low) * dir;
      case 'medium':
        return (a.counts.medium - b.counts.medium) * dir;
      case 'high':
        return (a.counts.high - b.counts.high) * dir;
      case 'total':
        return (a.counts.total - b.counts.total) * dir;
      default:
        return 0;
    }
  }), [hospitals, sortKey, sortDir]);

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader label="โรงพยาบาล" columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <TableHead>ฝากครรภ์</TableHead>
            <SortableHeader label="ระดับ" columnKey="level" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortableHeader label="เสี่ยงต่ำ" columnKey="low" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortableHeader label="เสี่ยงปานกลาง" columnKey="medium" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortableHeader label="เสี่ยงสูง" columnKey="high" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortableHeader label="รวม" columnKey="total" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <TableHead>สถานะ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((h) => (
            <TableRow
              key={h.hcode}
              ref={(el) => {
                if (el) rowRefs.current.set(h.hcode, el);
                else rowRefs.current.delete(h.hcode);
              }}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => router.push(`/hospitals/${h.hcode}`)}
            >
              <TableCell className="font-medium">{h.name}</TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Link
                  href={`/hospitals/${h.hcode}/pregnancies`}
                  className="rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 transition-colors"
                >
                  ดูฝากครรภ์
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{h.level}</Badge>
              </TableCell>
              <TableCell>
                {h.counts.low > 0 && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-sm text-green-700">
                    {h.counts.low}
                  </span>
                )}
                {h.counts.low === 0 && <span className="text-muted-foreground">-</span>}
              </TableCell>
              <TableCell>
                {h.counts.medium > 0 && (
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-sm text-yellow-700">
                    {h.counts.medium}
                  </span>
                )}
                {h.counts.medium === 0 && <span className="text-muted-foreground">-</span>}
              </TableCell>
              <TableCell>
                {h.counts.high > 0 && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-sm font-bold text-red-700">
                    {h.counts.high}
                  </span>
                )}
                {h.counts.high === 0 && <span className="text-muted-foreground">-</span>}
              </TableCell>
              <TableCell className="font-semibold">{h.counts.total || '-'}</TableCell>
              <TableCell>
                <ConnectionStatus
                  status={h.connectionStatus as ConnectionStatusEnum}
                  lastSyncAt={h.lastSyncAt}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
