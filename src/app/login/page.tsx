import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = '/', error } = await searchParams;
  return (
    <main className="min-h-screen bg-[#0f1117] flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-[#2a3445] bg-[#161b27] p-8">
        <h1 className="text-2xl font-semibold text-slate-200">Private area</h1>
        <p className="mt-2 text-slate-400">Enter the password to continue.</p>
        <form method="POST" action="/api/login" className="mt-6 space-y-4">
          <label htmlFor="password" className="block text-sm text-slate-300">Password</label>
          <input id="password" name="password" type="password" required autoFocus
            autoComplete="current-password"
            className="w-full rounded-md border border-[#2a3445] bg-[#0f1117] p-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="hidden" name="next" value={next} />
          {error && <p role="alert" className="text-sm text-red-400">Wrong password. Try again.</p>}
          <button type="submit" className="w-full rounded-md bg-blue-600 p-3 font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400">Sign in</button>
        </form>
      </div>
    </main>
  );
}
