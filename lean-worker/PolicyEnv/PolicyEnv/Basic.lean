-- PolicyEnv.Basic: Core numeric predicates for the Lean-Agent Protocol.
-- All values use integer arithmetic scaled to basis points (1 bps = 0.01%).
-- This avoids Float, which is not decidable in Lean 4's kernel.

namespace PolicyEnv

/--
  Returns true if tradeValue ≤ availableCapital × (maxBps / 10000).
  Default maxBps = 1000 → 10% threshold.
  Integer form: tradeValue * 10000 ≤ availableCapital * maxBps
-/
def tradeWithinCapital (tradeValue availableCapital : Nat)
    (maxBps : Nat := 1000) : Bool :=
  tradeValue * 10000 ≤ availableCapital * maxBps

/--
  Returns true if newWeightBps ≤ limitBps.
  Both arguments in basis points (e.g. 2200 = 22%, 3000 = 30%).
  Default limitBps = 2500 → 25% threshold.
-/
def positionWithinLimit (newWeightBps : Nat)
    (limitBps : Nat := 2500) : Bool :=
  newWeightBps ≤ limitBps

/--
  Returns true if |execPrice - refPrice| ≤ refPrice × (maxDeviationBps / 10000).
  Default maxDeviationBps = 500 → 5% threshold.
  Integer form: |execPrice - refPrice| * 10000 ≤ refPrice * maxDeviationBps
-/
def priceWithinDeviation (execPrice refPrice : Nat)
    (maxDeviationBps : Nat := 500) : Bool :=
  let diff := if execPrice ≥ refPrice
              then execPrice - refPrice
              else refPrice - execPrice
  diff * 10000 ≤ refPrice * maxDeviationBps

end PolicyEnv
