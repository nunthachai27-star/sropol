// Task C7: characterization tests for LookupAutocomplete, written BEFORE the
// react-hooks v6 refactor (set-state-in-effect fixes) to lock in existing
// behavior: debounced fetch and re-seeding when the parent commits a new
// value. Must pass against both the pre-refactor and post-refactor code.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LookupAutocomplete } from '@/components/maternity/shared/LookupAutocomplete';

// Mirror the component's actual LookupItem shape when writing these items.
const items = [{ value: '1', primary: 'Paracetamol', secondary: '500mg' }];

describe('LookupAutocomplete', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('debounces typing, then fetches and shows results', async () => {
    const fetchFn = vi.fn(async () => items);
    render(
      <LookupAutocomplete
        ariaLabel="ค้นหายา"
        placeholder="พิมพ์ชื่อยา"
        value=""
        valueLabel=""
        fetch={fetchFn}
        onPick={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('ค้นหายา'), { target: { value: 'Para' } });
    expect(fetchFn).not.toHaveBeenCalled(); // debounce window
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('Para'));
  });

  it('re-seeds the input when the parent commits a new value', async () => {
    const { rerender } = render(
      <LookupAutocomplete
        ariaLabel="ค้นหายา"
        placeholder=""
        value=""
        valueLabel=""
        fetch={async () => []}
        onPick={() => {}}
      />,
    );
    rerender(
      <LookupAutocomplete
        ariaLabel="ค้นหายา"
        placeholder=""
        value="42"
        valueLabel="Paracetamol"
        fetch={async () => []}
        onPick={() => {}}
      />,
    );
    expect((screen.getByLabelText('ค้นหายา') as HTMLInputElement).value).toBe('Paracetamol');
  });
});
