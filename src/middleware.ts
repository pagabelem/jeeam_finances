export { default } from 'next-auth/middleware';
export const config = { matcher: ['/((?!login|api/auth|api/cron|_next|favicon.ico|logo-jeeam.png|icon.png).*)'] };