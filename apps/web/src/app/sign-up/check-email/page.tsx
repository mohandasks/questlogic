import Link from "next/link";

export default function CheckEmailPage() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="panel grid w-full max-w-sm gap-4 p-6 text-center">
        <h1 className="text-2xl font-bold">Check your inbox</h1>
        <p className="text-sm text-mute">
          We sent a confirmation link to your email. Click it to finish setting
          up your account, then sign in.
        </p>
        <Link href="/sign-in" className="btn btn-primary">
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
