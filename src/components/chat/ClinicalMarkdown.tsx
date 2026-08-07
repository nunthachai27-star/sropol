'use client';

// Clinical-chat markdown renderer (codex-recommended stack).
// The clinical chatbot's LLM (deepseek-v4-flash) always replies in markdown;
// every assistant bubble renders through this component. Two hard constraints:
//   1. SAFETY — LLM output is not trusted enough to skip rehype-sanitize:
//      raw HTML <script>/attributes and javascript: URLs are neutralized.
//   2. FIDELITY — remark-gfm enables tables/strikethrough/task-lists (the
//      model emits Thai clinical tables); Tailwind typography (prose) styles
//      headings/lists/code consistently with the rest of the UI.
// No rehype-raw: the model may not smuggle raw HTML beyond what markdown
// intends, and sanitize stays the single line of defense.
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

export interface ClinicalMarkdownProps {
  children: string;
  className?: string;
}

export function ClinicalMarkdown({ children, className }: ClinicalMarkdownProps) {
  return (
    <div className={`prose prose-sm prose-slate max-w-none ${className ?? ''}`}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {children}
      </Markdown>
    </div>
  );
}
