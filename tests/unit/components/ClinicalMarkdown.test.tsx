/* @vitest-environment jsdom */
// TDD — ClinicalMarkdown renderer (codex-recommended stack:
// react-markdown + remark-gfm + rehype-sanitize). The clinical chatbot's LLM
// always returns markdown; we must render it (headings/bold/lists/tables/code)
// AND sanitize it — LLM output is not trusted enough to skip rehype-sanitize.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClinicalMarkdown } from '@/components/chat/ClinicalMarkdown';

describe('ClinicalMarkdown', () => {
  it('renders headings, bold, lists, and GFM tables', () => {
    render(
      <ClinicalMarkdown>
        {
          '# ชื่อเรื่อง\n\n**ความเสี่ยงสูง**\n\n- ข้อ ก\n- ข้อ ข\n\n| หัว | ค่า |\n| --- | --- |\n| สบพ | 28 |'
        }
      </ClinicalMarkdown>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'ชื่อเรื่อง' })).toBeInTheDocument();
    expect(screen.getByText('ความเสี่ยงสูง')).toBeInTheDocument();
    expect(screen.getByText('ข้อ ก')).toBeInTheDocument();
    expect(screen.getByText('ข้อ ข')).toBeInTheDocument();
    // GFM table: header + row cells present.
    expect(screen.getByText('สบพ')).toBeInTheDocument();
    expect(screen.getByText('28')).toBeInTheDocument();
  });

  it('renders fenced code blocks as <code>', () => {
    render(<ClinicalMarkdown>{'```ts\nconst x = 1;\n```'}</ClinicalMarkdown>);
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(document.querySelector('code')).not.toBeNull();
  });

  it('neutralizes javascript: URLs in markdown links (rehype-sanitize)', () => {
    // Verified empirically: react-markdown + rehype-sanitize render
    // [ลิงก์](javascript:alert(1)) as <a>ลิงก์</a> with NO href attribute — the
    // unsafe scheme is dropped, so a click never runs XSS. (An href-less <a>
    // has no "link" accessibility role, so query by element/text, not role.)
    const { container } = render(
      <ClinicalMarkdown>{'[ลิงก์](javascript:alert(1))'}</ClinicalMarkdown>,
    );
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    const href = link?.getAttribute('href') ?? null;
    expect(href === null || !href.startsWith('javascript:')).toBe(true);
    expect(container.innerHTML).toContain('>ลิงก์</a>');
  });

  it('renders raw HTML as escaped text, never an executing <script>/element', () => {
    // No rehype-raw: raw <b> and <script> become literal text, so nothing
    // executes and no stray element leaks into the page.
    const { container } = render(
      <ClinicalMarkdown>{'ปกติ <b>กล้า</b> <script>window.__x=1</script>'}</ClinicalMarkdown>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('กล้า');
    expect(container.textContent).toContain('window.__x=1');
  });
});
