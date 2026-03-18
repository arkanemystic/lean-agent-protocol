import PolicyEnv.Basic

-- CAP-001: Do not execute trades exceeding 10% of the firm's available daily capital.

namespace PolicyEnv

/-- CAP-001 maximum trade fraction: 10% = 1000 basis points -/
def cap001MaxBps : Nat := 1000

/--
  CAP-001 compliance predicate.
  tradeValue and availableCapital are dollar amounts (integer cents or whole dollars,
  consistent units). Returns true when tradeValue ≤ availableCapital × 0.10.
-/
def cap001Compliant (tradeValue availableCapital : Nat) : Bool :=
  tradeWithinCapital tradeValue availableCapital cap001MaxBps

end PolicyEnv
