import { SignalingConnect } from "./components/SignalingConnect";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-black">
      <main className="flex w-full max-w-xl flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Syncopate
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Two-musician P2P jamming. Signaling scaffold is live — clock and
          metronome come next.
        </p>
        <SignalingConnect />
      </main>
    </div>
  );
}
