import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth/session';

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0,
  });
  return response;
}
