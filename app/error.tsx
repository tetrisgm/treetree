"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="grid min-h-screen place-items-center bg-[#07090d] px-6 text-white"><div className="max-w-md text-center"><p className="eyebrow">Family tree</p><h1 className="mt-3 font-serif text-3xl">The tree could not be loaded.</h1><p className="mt-3 text-sm leading-6 text-slate-300">Your family data is preserved. Try loading the archive again.</p><button className="mt-6 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black" onClick={reset}>Try again</button></div></main>;
}
