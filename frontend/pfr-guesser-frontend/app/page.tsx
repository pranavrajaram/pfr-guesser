"use client"

import { useState, useEffect, useRef } from "react"
import { Loader2, Check, Copy, ExternalLink, HelpCircle, Trophy, Target, Zap, X, RefreshCw, Flag } from "lucide-react"

interface SeasonStats {
  season: number
  team: string | null
  games: number | null
  awards: string | null
  // QB-specific
  games_started?: number | null
  completions?: number | null
  attempts?: number | null
  yards?: number | null
  touchdowns?: number | null
  interceptions?: number | null
  passer_rating?: number | null
  // WR-specific
  targets?: number | null
  receptions?: number | null
  yards_per_reception?: number | null
  // RB-specific
  yards_per_attempt?: number | null
  receiving_yards?: number | null
}

type Position = "QB" | "WR" | "RB"

interface GuessResult {
  name: string
  correct: boolean
  era?: "same" | "far"
  teams_overlap?: boolean
  pfr_id?: string
}

type GameMode = "daily" | "unlimited"

// Use environment variable for API URL
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function QBGuessingGame() {
  const MAX_GUESSES = 8
  const inputRef = useRef<HTMLInputElement>(null)

  const [gameMode, setGameMode] = useState<GameMode>("daily")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [position, setPosition] = useState<Position>("QB")
  const [seasons, setSeasons] = useState<SeasonStats[]>([])
  const [guess, setGuess] = useState("")
  const [guesses, setGuesses] = useState<GuessResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gameWon, setGameWon] = useState(false)
  const [gameLost, setGameLost] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [answerPfrId, setAnswerPfrId] = useState<string | null>(null)
  const [answerPosition, setAnswerPosition] = useState<Position | null>(null)
  const [copied, setCopied] = useState(false)

  const [showSeasons, setShowSeasons] = useState(false)
  const [showTeams, setShowTeams] = useState(false)
  const [showAwards, setShowAwards] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1)

  const hintsUsed = [showSeasons, showTeams, showAwards].filter(Boolean).length

  useEffect(() => {
    loadGame("daily")
  }, [])

  useEffect(() => {
    if (!guess.trim()) {
      setSuggestions([])
      setSelectedSuggestionIndex(-1)
      return
    }

    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_URL}/autocomplete?q=${encodeURIComponent(guess)}`
        )
        if (!res.ok) throw new Error('Autocomplete failed')
        const data = await res.json()
        setSuggestions(data.players || [])
        setShowSuggestions(true)
        setSelectedSuggestionIndex(-1)
      } catch {
        setSuggestions([])
      }
    }, 200)

    return () => clearTimeout(timeout)
  }, [guess])

  const loadGame = async (mode: GameMode) => {
    setLoading(true)
    setError(null)
    try {
      const endpoint = mode === "daily" ? "/daily_qb" : "/random_qb"
      const res = await fetch(`${API_URL}${endpoint}`, {
        cache: "no-store"
      })
      
      if (!res.ok) {
        throw new Error('Failed to load game')
      }
      
      const data = await res.json()
      setSessionId(data.session_id)
      setSeasons(data.seasons)
      setPosition(data.position || "QB")
      setGameMode(mode)
      
      setGuesses([])
      setGameWon(false)
      setGameLost(false)
      setAnswer(null)
      setAnswerPfrId(null)
      setAnswerPosition(null)
      setGuess("")
      setShowSeasons(false)
      setShowTeams(false)
      setShowAwards(false)
      
    } catch (err) {
      console.error("Failed to load game", err)
      setError("Failed to load game. Please refresh the page.")
    } finally {
      setLoading(false)
    }
  }

  const revealAnswer = async () => {
    if (!sessionId) return
    
    try {
      const res = await fetch(`${API_URL}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId })
      })
      
      if (!res.ok) {
        const errorData = await res.json()
        const errorMessage = errorData.detail || 'Failed to reveal answer'
        
        if (res.status === 404 && errorMessage.includes("Session not found")) {
          console.log("Session expired, reloading game...")
          await loadGame(gameMode)
          setError("Your session expired. A new game has been loaded!")
          setTimeout(() => setError(null), 3000)
          return
        }
        
        throw new Error(errorMessage)
      }
      
      const data = await res.json()
      setAnswer(data.name)
      setAnswerPfrId(data.pfr_id)
      setAnswerPosition(data.position || null)
      setGameLost(true)
    } catch (err) {
      console.error("Failed to reveal answer", err)
      setError(err instanceof Error ? err.message : "Failed to reveal answer")
    }
  }

  const submitGuess = async () => {
    if (!guess.trim() || gameWon || gameLost || !sessionId) return
    if (guesses.length >= MAX_GUESSES) return

    try {
      const res = await fetch(`${API_URL}/guess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          guess,
          session_id: sessionId 
        })
      })

      if (!res.ok) {
        const errorData = await res.json()
        const errorMessage = errorData.detail || 'Guess failed'
        
        if (res.status === 404 && errorMessage.includes("Session not found")) {
          console.log("Session expired, reloading game...")
          await loadGame(gameMode)
          setError("Your session expired. A new game has been loaded!")
          setTimeout(() => setError(null), 3000)
          return
        }
        
        throw new Error(errorMessage)
      }

      const data = await res.json()

      const newGuesses = [
        ...guesses,
        {
          name: guess,
          correct: data.correct,
          era: data.feedback?.era,
          teams_overlap: data.feedback?.teams_overlap,
          pfr_id: data.pfr_id
        }
      ]

      setGuesses(newGuesses)

      if (data.correct) {
        setGameWon(true)
      } else if (newGuesses.length >= MAX_GUESSES) {
        await revealAnswer()
      }

      setGuess("")
      setSuggestions([])
      setShowSuggestions(false)
    } catch (err) {
      console.error("Guess failed", err)
      setError(err instanceof Error ? err.message : "Failed to submit guess")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedSuggestionIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : 0
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedSuggestionIndex(prev => 
          prev > 0 ? prev - 1 : suggestions.length - 1
        )
      } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
        e.preventDefault()
        setGuess(suggestions[selectedSuggestionIndex])
        setSuggestions([])
        setShowSuggestions(false)
        setSelectedSuggestionIndex(-1)
      } else if (e.key === 'Enter') {
        submitGuess()
      } else if (e.key === 'Escape') {
        setShowSuggestions(false)
      }
    } else if (e.key === 'Enter') {
      submitGuess()
    }
  }

  const handleShare = async () => {
    const modeEmoji = gameMode === "daily" ? "📅" : "🔄"
    const resultEmoji = gameWon ? "🏆" : "💀"
    const guessEmojis = guesses.map(g => {
      if (g.correct) return "🟢"
      if (g.teams_overlap) return "🟠"
      if (g.era === "same") return "🟡"
      return "⚫"
    }).join("")

    // Build list of hints used
    const hintsList = []
    if (showSeasons) hintsList.push("Seasons")
    if (showTeams) hintsList.push("Teams")
    if (showAwards) hintsList.push("Awards")
    const hintsText = hintsList.length > 0 ? ` (${hintsList.join(", ")})` : ""

    const shareText = `${modeEmoji} Drake Maye-dle ${resultEmoji}
${guessEmojis}
${guesses.length}/${MAX_GUESSES} guesses | ${hintsUsed} hint${hintsUsed !== 1 ? "s" : ""}${hintsText}
${window.location.origin}`

    try {
      await navigator.clipboard.writeText(shareText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Failed to copy to clipboard")
    }
  }

  const switchMode = (mode: GameMode) => {
    if (mode !== gameMode) {
      loadGame(mode)
    }
  }

  const getPfrUrl = (pfrId: string) => {
    return `https://www.pro-football-reference.com/players/${pfrId.charAt(0)}/${pfrId}.htm`
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center pattern-grid">
        <div className="text-center animate-fade-in-up">
          <div className="relative">
            <div className="w-20 h-20 rounded-full border-4 border-[#00d4aa]/20 border-t-[#00d4aa] animate-spin mx-auto" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl">🏈</span>
            </div>
          </div>
          <p className="mt-6 text-[#6b7280] font-medium">Loading game...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error && !seasons.length) {
    return (
      <div className="min-h-screen flex items-center justify-center pattern-grid p-4">
        <div className="glass rounded-3xl p-8 max-w-md w-full border border-[#2a3046] animate-fade-in-up text-center">
          <div className="w-16 h-16 rounded-full bg-[#ef4444]/10 flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-[#ef4444]" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Oops!</h2>
          <p className="text-[#6b7280] mb-6">{error}</p>
          <button 
            onClick={() => loadGame(gameMode)}
            className="w-full py-4 px-6 rounded-2xl font-semibold bg-gradient-to-r from-[#00d4aa] to-[#00b894] text-[#0c0f1a] hover:opacity-90 transition-all active:scale-[0.98]"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pattern-grid">
      {/* Floating orbs for depth */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-[#00d4aa]/10 rounded-full blur-3xl animate-float" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#7c3aed]/10 rounded-full blur-3xl animate-float delay-300" />
      </div>

      <div className="relative container mx-auto px-4 py-6 max-w-5xl">
        {/* Header */}
        <header className="flex items-center justify-between mb-8 animate-fade-in-up">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#00d4aa] to-[#00b894] flex items-center justify-center text-2xl shadow-lg glow-sm">
              🏈
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold gradient-text">Drake Maye-dle</h1>
              <p className="text-sm text-[#6b7280] hidden sm:block">Guess the player from their stats</p>
            </div>
          </div>
          
          <button 
            onClick={() => setShowHelp(true)}
            className="w-11 h-11 rounded-xl bg-[#1e2438] border border-[#2a3046] flex items-center justify-center hover:bg-[#2a3046] hover:border-[#00d4aa]/50 transition-all group"
            aria-label="Help"
          >
            <HelpCircle className="w-5 h-5 text-[#6b7280] group-hover:text-[#00d4aa] transition-colors" />
          </button>
        </header>

        {/* Error toast */}
        {error && seasons.length > 0 && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 glass rounded-2xl px-6 py-3 border border-[#f59e0b]/50 animate-fade-in">
            <p className="text-[#f59e0b] font-medium text-sm">{error}</p>
          </div>
        )}

        {/* Help Modal */}
        {showHelp && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setShowHelp(false)}
          >
            <div 
              className="relative w-full max-w-lg glass rounded-3xl border border-[#2a3046] overflow-hidden animate-fade-in-up"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header gradient */}
              <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-[#00d4aa]/10 to-transparent pointer-events-none" />
              
              <div className="relative p-6 sm:p-8">
                <button 
                  onClick={() => setShowHelp(false)}
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-[#2a3046] flex items-center justify-center hover:bg-[#3a4056] transition-colors"
                >
                  <X className="w-4 h-4 text-[#6b7280]" />
                </button>

                <div className="text-center mb-6">
                  <h2 className="text-3xl font-bold gradient-text mb-2">How to Play</h2>
                  <p className="text-[#6b7280]">Guess the mystery player from their stats</p>
                </div>

                <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                  <div className="flex gap-4 p-4 rounded-2xl bg-[#161b2e] border border-[#2a3046]">
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-[#00d4aa] to-[#00b894] flex items-center justify-center">
                      <Target className="w-5 h-5 text-[#0c0f1a]" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white mb-1">Make Guesses</h3>
                      <p className="text-sm text-[#6b7280]">
                        You have <span className="text-[#00d4aa] font-semibold">{MAX_GUESSES} attempts</span> to identify the player from their career stats. The pool includes QBs (2,000+ passing yards), WRs (1,500+ receiving yards), and RBs (1,500+ rushing yards) since 2010.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-2xl bg-[#161b2e] border border-[#2a3046]">
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-[#f59e0b] to-[#d97706] flex items-center justify-center">
                      <Zap className="w-5 h-5 text-[#0c0f1a]" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white mb-1">Use Hints</h3>
                      <p className="text-sm text-[#6b7280]">
                        Toggle <span className="text-white">Seasons</span>, <span className="text-white">Teams</span>, or <span className="text-white">Awards</span> for extra clues.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#161b2e] border border-[#2a3046]">
                    <h3 className="font-semibold text-white mb-3">Feedback Colors</h3>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <span className="w-4 h-4 rounded-md bg-[#22c55e]" />
                        <span className="text-sm text-[#6b7280]">Correct answer!</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="w-4 h-4 rounded-md bg-[#f59e0b]" />
                        <span className="text-sm text-[#6b7280]">Played for the same team</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="w-4 h-4 rounded-md bg-[#eab308]" />
                        <span className="text-sm text-[#6b7280]">Same era (within 2 years)</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="w-4 h-4 rounded-md bg-[#374151]" />
                        <span className="text-sm text-[#6b7280]">No match</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-2xl bg-[#161b2e] border border-[#2a3046]">
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-[#7c3aed] to-[#6d28d9] flex items-center justify-center">
                      <Trophy className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white mb-1">Game Modes</h3>
                      <p className="text-sm text-[#6b7280]">
                        <span className="text-white">📅 Daily:</span> Same QB for everyone.
                        <br />
                        <span className="text-white">🔄 Unlimited:</span> Random QBs, play forever!
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowHelp(false)}
                  className="w-full mt-6 py-4 px-6 rounded-2xl font-semibold bg-gradient-to-r from-[#00d4aa] to-[#00b894] text-[#0c0f1a] hover:opacity-90 transition-all active:scale-[0.98]"
                >
                  Let&apos;s Play!
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Game Mode Toggle */}
        <div className="flex justify-center mb-6 animate-fade-in-up delay-100">
          <div className="inline-flex p-1 rounded-2xl bg-[#161b2e] border border-[#2a3046]">
            <button
              onClick={() => switchMode("daily")}
              className={`px-6 py-3 rounded-xl font-medium transition-all ${
                gameMode === "daily"
                  ? "bg-gradient-to-r from-[#00d4aa] to-[#00b894] text-[#0c0f1a] shadow-lg"
                  : "text-[#6b7280] hover:text-white"
              }`}
            >
              📅 Daily
            </button>
            <button
              onClick={() => switchMode("unlimited")}
              className={`px-6 py-3 rounded-xl font-medium transition-all ${
                gameMode === "unlimited"
                  ? "bg-gradient-to-r from-[#00d4aa] to-[#00b894] text-[#0c0f1a] shadow-lg"
                  : "text-[#6b7280] hover:text-white"
              }`}
            >
              🔄 Unlimited
            </button>
          </div>
        </div>

        {/* Stats & Hints Section */}
        <div className="grid gap-4 mb-6 animate-fade-in-up delay-200">
          {/* Progress indicator */}
          <div className="flex items-center justify-between glass rounded-2xl px-5 py-4 border border-[#2a3046]">
            <div className="flex items-center gap-3">
              <span className="text-[#6b7280] text-sm font-medium">Progress</span>
              <div className="flex gap-1.5">
                {Array.from({ length: MAX_GUESSES }).map((_, i) => {
                  const g = guesses[i]
                  let bgClass = "bg-[#2a3046]"
                  if (g?.correct) bgClass = "bg-[#22c55e]"
                  else if (g?.teams_overlap) bgClass = "bg-[#f59e0b]"
                  else if (g?.era === "same") bgClass = "bg-[#eab308]"
                  else if (g) bgClass = "bg-[#374151]"
                  
                  return (
                    <div 
                      key={i} 
                      className={`w-3 h-3 rounded-full transition-all ${bgClass} ${g ? 'scale-100' : 'scale-75 opacity-50'}`} 
                    />
                  )
                })}
              </div>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-white">{guesses.length}</span>
              <span className="text-[#6b7280] text-sm">/{MAX_GUESSES}</span>
            </div>
          </div>

          {/* Hint buttons */}
          <div className="flex flex-wrap gap-2">
            {[
              { key: 'seasons', label: 'Seasons', active: showSeasons, toggle: () => setShowSeasons(true) },
              { key: 'teams', label: 'Teams', active: showTeams, toggle: () => setShowTeams(true) },
              { key: 'awards', label: 'Awards', active: showAwards, toggle: () => setShowAwards(true) },
            ].map(hint => (
              <button
                key={hint.key}
                onClick={hint.toggle}
                disabled={hint.active}
                className={`flex-1 min-w-[100px] py-3 px-4 rounded-xl font-medium transition-all border ${
                  hint.active
                    ? "bg-[#00d4aa]/10 border-[#00d4aa]/50 text-[#00d4aa]"
                    : "bg-[#161b2e] border-[#2a3046] text-[#6b7280] hover:border-[#00d4aa]/30 hover:text-white"
                }`}
              >
                {hint.active ? `✓ ${hint.label}` : `Show ${hint.label}`}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Table */}
        <div className="glass rounded-3xl border border-[#2a3046] overflow-hidden mb-6 animate-fade-in-up delay-300">
          {/* Position badge */}
          <div className="px-4 py-2 bg-[#161b2e] border-b border-[#2a3046] flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
              position === "QB" 
                ? "bg-[#7c3aed]/20 text-[#a78bfa]" 
                : position === "WR"
                ? "bg-[#f59e0b]/20 text-[#fbbf24]"
                : "bg-[#22c55e]/20 text-[#4ade80]"
            }`}>
              {position === "QB" ? "🏈 Quarterback" : position === "WR" ? "🎯 Wide Receiver" : "🏃 Running Back"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a3046] bg-[#161b2e]">
                  {showSeasons && <th className="px-4 py-4 text-left font-semibold text-[#00d4aa]">Year</th>}
                  {showTeams && <th className="px-4 py-4 text-left font-semibold text-[#00d4aa]">Team</th>}
                  <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">G</th>
                  {position === "QB" && (
                    <>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">GS</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Cmp</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Att</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Yds</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">TD</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Int</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Rate</th>
                    </>
                  )}
                  {position === "WR" && (
                    <>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Tgt</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Rec</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Yds</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Y/R</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">TD</th>
                    </>
                  )}
                  {position === "RB" && (
                    <>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Att</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Yds</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Y/A</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">TD</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">Rec</th>
                      <th className="px-3 py-4 text-right font-semibold text-[#6b7280]">RecYds</th>
                    </>
                  )}
                  {showAwards && <th className="px-4 py-4 text-left font-semibold text-[#00d4aa]">Awards</th>}
                </tr>
              </thead>
              <tbody>
                {seasons.map((s, i) => (
                  <tr 
                    key={i} 
                    className="border-b border-[#2a3046]/50 hover:bg-[#1e2438] transition-colors"
                  >
                    {showSeasons && <td className="px-4 py-3 font-mono font-medium text-white">{s.season}</td>}
                    {showTeams && <td className="px-4 py-3 font-medium text-white">{s.team ?? "—"}</td>}
                    <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">{s.games ?? "—"}</td>
                    {position === "QB" && (
                      <>
                        <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">{s.games_started ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">{s.completions ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">{s.attempts ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-white font-mono font-medium">{s.yards ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-[#22c55e] font-mono font-medium">{s.touchdowns ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-[#ef4444] font-mono font-medium">{s.interceptions ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-white font-mono font-medium">
                          {s.passer_rating != null ? Number(s.passer_rating).toFixed(1) : "—"}
                        </td>
                      </>
                    )}
                    {position === "WR" && (
                      <>
                        <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">{s.targets ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">{s.receptions ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-white font-mono font-medium">{s.yards ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">
                          {s.yards_per_reception != null ? Number(s.yards_per_reception).toFixed(1) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right text-[#22c55e] font-mono font-medium">{s.touchdowns ?? "—"}</td>
                      </>
                    )}
                    {position === "RB" && (
                      <>
                        <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">{s.attempts ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-white font-mono font-medium">{s.yards ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">
                          {s.yards_per_attempt != null ? Number(s.yards_per_attempt).toFixed(1) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right text-[#22c55e] font-mono font-medium">{s.touchdowns ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">{s.receptions ?? "—"}</td>
                        <td className="px-3 py-3 text-right text-[#9ca3af] font-mono">{s.receiving_yards ?? "—"}</td>
                      </>
                    )}
                    {showAwards && <td className="px-4 py-3 text-[#f59e0b] text-xs">{s.awards ?? "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Guess Input */}
        <div className="relative z-30 glass rounded-3xl border border-[#2a3046] p-4 mb-6 animate-fade-in-up delay-400 overflow-visible">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={guess}
                onChange={e => setGuess(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="Type a player's name..."
                disabled={gameWon || gameLost}
                className="w-full h-14 px-5 rounded-2xl bg-[#161b2e] border border-[#2a3046] text-white placeholder-[#6b7280] font-medium focus:border-[#00d4aa] focus:ring-1 focus:ring-[#00d4aa] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              />
              
              {/* Autocomplete dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-2 py-2 rounded-2xl bg-[#1e2438] border border-[#2a3046] shadow-2xl max-h-64 overflow-y-auto">
                  {suggestions.map((name, idx) => (
                    <div
                      key={name}
                      className={`px-5 py-3 cursor-pointer transition-colors ${
                        idx === selectedSuggestionIndex
                          ? "bg-[#00d4aa]/10 text-[#00d4aa]"
                          : "text-white hover:bg-[#2a3046]"
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setGuess(name)
                        setSuggestions([])
                        setShowSuggestions(false)
                        inputRef.current?.focus()
                      }}
                    >
                      {name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <button 
              onClick={submitGuess}
              disabled={!guess.trim() || gameWon || gameLost}
              className="h-14 px-8 rounded-2xl font-semibold bg-gradient-to-r from-[#00d4aa] to-[#00b894] text-[#0c0f1a] hover:opacity-90 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed shadow-lg glow-sm"
            >
              Guess
            </button>
            <button 
              onClick={revealAnswer}
              disabled={gameWon || gameLost}
              className="h-14 px-5 rounded-2xl font-semibold bg-[#1e2438] border border-[#2a3046] text-[#6b7280] hover:text-[#ef4444] hover:border-[#ef4444]/50 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              title="Give up and reveal the answer"
            >
              <Flag className="w-4 h-4" />
              <span className="hidden sm:inline">Give Up</span>
            </button>
          </div>
        </div>

        {/* Guesses List */}
        {guesses.length > 0 && (
          <div className="space-y-2 mb-6 animate-fade-in-up">
            {guesses.map((g, i) => {
              let bgClass = "bg-[#374151] border-[#4b5563]"
              let textClass = "text-[#9ca3af]"
              
              if (g.correct) {
                bgClass = "bg-gradient-to-r from-[#22c55e] to-[#16a34a] border-transparent"
                textClass = "text-white"
              } else if (g.teams_overlap) {
                bgClass = "bg-gradient-to-r from-[#f59e0b] to-[#d97706] border-transparent"
                textClass = "text-white"
              } else if (g.era === "same") {
                bgClass = "bg-gradient-to-r from-[#eab308] to-[#ca8a04] border-transparent"
                textClass = "text-[#0c0f1a]"
              }

              return (
                <div
                  key={i}
                  className={`flex items-center justify-between px-5 py-4 rounded-2xl font-medium border transition-all ${bgClass} ${textClass}`}
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <span className="font-semibold">{g.name}</span>
                  <div className="flex items-center gap-3">
                    {g.pfr_id && (
                      <a
                        href={getPfrUrl(g.pfr_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="opacity-70 hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    {g.correct && <Check className="w-5 h-5" />}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Game End Card */}
        {(gameWon || gameLost) && (
          <div className={`glass rounded-3xl border p-6 sm:p-8 animate-fade-in-up ${
            gameWon ? "border-[#22c55e]/50" : "border-[#2a3046]"
          }`}>
            {gameWon && (
              <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
                <div className="absolute inset-0 bg-gradient-to-br from-[#22c55e]/10 via-transparent to-[#00d4aa]/10" />
              </div>
            )}
            
            <div className="relative text-center mb-6">
              <div className="text-5xl mb-3">{gameWon ? "🏆" : "😔"}</div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-1">
                {gameWon ? "You Got It!" : "Game Over"}
              </h2>
              {gameLost && answer && (
                <p className="text-[#6b7280]">
                  The answer was <span className="text-[#00d4aa] font-semibold">{answer}</span>
                  {answerPosition && (
                    <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-bold ${
                      answerPosition === "QB" 
                        ? "bg-[#7c3aed]/20 text-[#a78bfa]" 
                        : answerPosition === "WR"
                        ? "bg-[#f59e0b]/20 text-[#fbbf24]"
                        : "bg-[#22c55e]/20 text-[#4ade80]"
                    }`}>
                      {answerPosition}
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* Stats summary */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="text-center p-4 rounded-2xl bg-[#161b2e] border border-[#2a3046]">
                <div className="text-2xl font-bold text-white">{guesses.length}</div>
                <div className="text-xs text-[#6b7280]">Guesses</div>
              </div>
              <div className="text-center p-4 rounded-2xl bg-[#161b2e] border border-[#2a3046]">
                <div className="text-2xl font-bold text-white">{hintsUsed}</div>
                <div className="text-xs text-[#6b7280]">Hints</div>
              </div>
              <div className="text-center p-4 rounded-2xl bg-[#161b2e] border border-[#2a3046]">
                <div className="text-2xl font-bold text-white">{gameMode === "daily" ? "📅" : "🔄"}</div>
                <div className="text-xs text-[#6b7280]">Mode</div>
              </div>
            </div>

            {answerPfrId && (
              <a
                href={getPfrUrl(answerPfrId)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 mb-6 text-[#00d4aa] hover:underline font-medium"
              >
                View on Pro Football Reference
                <ExternalLink className="w-4 h-4" />
              </a>
            )}

            <div className="flex gap-3">
              <button 
                onClick={handleShare} 
                className="flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-2xl font-semibold bg-[#161b2e] border border-[#2a3046] text-white hover:bg-[#1e2438] transition-all active:scale-[0.98]"
              >
                {copied ? <Check className="w-5 h-5 text-[#22c55e]" /> : <Copy className="w-5 h-5" />}
                {copied ? "Copied!" : "Share"}
              </button>
              <button 
                onClick={() => gameMode === "daily" ? loadGame("unlimited") : loadGame("unlimited")} 
                className="flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-2xl font-semibold bg-gradient-to-r from-[#00d4aa] to-[#00b894] text-[#0c0f1a] hover:opacity-90 transition-all active:scale-[0.98] shadow-lg"
              >
                <RefreshCw className="w-5 h-5" />
                {gameMode === "daily" ? "Play Unlimited" : "New Game"}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="text-center mt-8 pb-4">
          <p className="text-[#6b7280] text-xs">
            Data from{" "}
            <a href="https://www.pro-football-reference.com" target="_blank" rel="noopener noreferrer" className="text-[#00d4aa] hover:underline">
              Pro Football Reference
            </a>
          </p>
        </footer>
      </div>
    </div>
  )
}
