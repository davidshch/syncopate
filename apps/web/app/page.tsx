import { Hud } from "./components/Hud";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 font-sans dark:bg-black">
      <main className="flex w-full max-w-xl flex-col gap-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Syncopate
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Shared metronome on a Cristian/NTP clock. Start on two machines; the
          worklet clicks in phase from the server epoch.
        </p>
        <Hud />
      </main>
    </div>
  );
}
