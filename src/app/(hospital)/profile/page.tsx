import { auth } from '@/lib/auth';
import { maskName, maskCid } from '@/lib/pii-mask';
import { NotificationPreferenceCard } from '@/components/profile/NotificationPreferenceCard';

export async function ProfilePage() {
  const session = await auth();
  const user = session?.user;
  const displayName = maskName(user?.name);
  const displayCid = maskCid(user?.userCid);
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">โปรไฟล์และการแจ้งเตือน</h1>
      <section className="rounded-2xl border border-slate-200 p-4">
        <p className="text-sm text-slate-500">{user?.hospitalName ?? ''}</p>
        <p className="text-base font-medium">{displayName}</p>
        <p className="text-xs text-slate-400">CID {displayCid}</p>
      </section>
      <NotificationPreferenceCard />
    </main>
  );
}

export default ProfilePage;
