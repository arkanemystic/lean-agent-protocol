import PolicyEnv.Basic

-- PRC-001: Reject any order where the execution price deviates more than 5%
--          from the 15-minute moving average.

namespace PolicyEnv

/-- PRC-001 maximum price deviation: 5% = 500 basis points -/
def prc001MaxDeviationBps : Nat := 500

/--
  PRC-001 compliance predicate.
  execPrice and refPrice are integer prices (same units).
  Returns true when |execPrice - refPrice| ≤ refPrice × 0.05.
-/
def prc001Compliant (execPrice refPrice : Nat) : Bool :=
  priceWithinDeviation execPrice refPrice prc001MaxDeviationBps

end PolicyEnv
