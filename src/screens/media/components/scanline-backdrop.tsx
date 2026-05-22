// ScanlineBackdrop — ambient FX scanline + gradient backdrop.
// Respects prefers-reduced-motion via motion-reduce:hidden.

export function ScanlineBackdrop() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 -z-10 motion-reduce:hidden"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to bottom, rgba(0, 229, 255, 0.045) 0, rgba(0, 229, 255, 0.045) 1px, transparent 1px, transparent 3px)',
          maskImage:
            'radial-gradient(ellipse at center, black 30%, rgba(0,0,0,0.5) 80%, transparent 100%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0, 229, 255, 0.06), transparent 60%), radial-gradient(ellipse 60% 60% at 50% 100%, rgba(255, 79, 216, 0.04), transparent 60%)',
        }}
      />
    </>
  )
}
