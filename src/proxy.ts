import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, isValidSession } from '@/lib/auth/session';

const OPEN_PATHS = ['/login', '/api/login', '/api/cron'];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.some(path => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }
  if (await isValidSession(request.cookies.get(COOKIE_NAME)?.value, process.env['AUTH_SECRET'])) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const login = new URL('/login', request.url);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'] };
