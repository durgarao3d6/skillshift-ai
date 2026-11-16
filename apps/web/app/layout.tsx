import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'SkillShift AI · Workforce workspace',
  description: 'Map tasks, understand development needs and build practical learning plans.',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
