import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, SESSION_DAYS, createSession, passwordMatches } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const destination = form.get('next');
  // Reject backslashes/control characters too: URL parsing can turn /\\host
  // or a slash plus stripped control characters into an external redirect.
  const next = typeof destination === 'string' && destination.startsWith('/') &&
    !destination.startsWith('//') && !/[\\\u0000-\u0020\u007f]/.test(destination)
    ? destination : '/';
  const password = form.get('password');
  const secret = process.env['AUTH_SECRET'];
  if (!secret || typeof password !== 'string' ||
      !await passwordMatches(password, process.env['SITE_PASSWORD'])) {
    const login = new URL('/login', request.url);
    login.searchParams.set('error', '1');
    login.searchParams.set('next', next);
    return NextResponse.redirect(login, 303);
  }
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(COOKIE_NAME, await createSession(secret), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return response;
}
