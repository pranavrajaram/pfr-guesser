"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { Loader2, Check, Copy, AlertCircle, ExternalLink } from "lucide-react"

interface SeasonStats {
  season: number
  team: string | null
  games: number | null
  games_started: number | null
  completions: number | null
  attempts: number | null
  yards: number | null
  touchdowns: number | null
  interceptions: number | null
  passer_rating: number | null
  awards: string | null
}

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

  const [gameMode, setGameMode] = useState<GameMode>("daily")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<SeasonStats[]>([])
  const [guess, setGuess] = useState("")
  const [guesses, setGuesses] = useState<GuessResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gameWon, setGameWon] = useState(false)
  const [gameLost, setGameLost] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [answerPfrId, setAnswerPfrId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [showSeasons, setShowSeasons] = useState(false)
  const [showTeams, setShowTeams] = useState(false)
  const [showAwards, setShowAwards] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  const hintsUsed = [showSeasons, showTeams, showAwards].filter(Boolean).length

  useEffect(() => {
    loadQB("daily")
    const root = document.documentElement
    root.style.colorScheme = 'dark'
    root.classList.add('dark')
  }, [])

  useEffect(() => {
    if (!guess.trim()) {
      setSuggestions([])
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
      } catch {
        setSuggestions([])
      }
    }, 250)

    return () => clearTimeout(timeout)
  }, [guess])

  const loadQB = async (mode: GameMode) => {
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
      setGameMode(mode)
      
      // Reset game state
      setGuesses([])
      setGameWon(false)
      setGameLost(false)
      setAnswer(null)
      setAnswerPfrId(null)
      setGuess("")
      setShowSeasons(false)
      setShowTeams(false)
      setShowAwards(false)
      
    } catch (err) {
      console.error("Failed to load QB", err)
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
      
      if (!res.ok) throw new Error('Failed to reveal answer')
      
      const data = await res.json()
      setAnswer(data.name)
      setAnswerPfrId(data.pfr_id)
      setGameLost(true)
    } catch (err) {
      console.error("Failed to reveal answer", err)
      setError("Failed to reveal answer")
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
        throw new Error(errorData.detail || 'Guess failed')
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      submitGuess()
    }
  }

  const handleShare = async () => {
    const modeEmoji = gameMode === "daily" ? "📅" : "🔄"
    const shareText = `${modeEmoji} Drake Maye-dle 🏈
Mode: ${gameMode === "daily" ? "Daily" : "Unlimited"}
Result: ${gameWon ? "Win" : "Loss"}
Guesses: ${guesses.length}/${MAX_GUESSES}
Hints used: ${hintsUsed}
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
      loadQB(mode)
    }
  }

  const getPfrUrl = (pfrId: string) => {
    return `https://www.pro-football-reference.com/players/${pfrId.charAt(0)}/${pfrId}.htm`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <Loader2 className="w-10 h-10 animate-spin text-blue-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <Card className="p-8 max-w-md bg-slate-800/90 border-2 border-red-500/50">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="w-6 h-6 text-red-400" />
            <h2 className="text-xl font-bold text-white">Error</h2>
          </div>
          <p className="text-slate-300 mb-4">{error}</p>
          <Button 
            onClick={() => loadQB(gameMode)}
            className="w-full bg-blue-500 hover:bg-blue-600"
          >
            Try Again
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="container mx-auto px-4 py-8 max-w-6xl relative">
        {/* Help Button - Top Right */}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setShowHelp(p => !p)}
          className="fixed top-4 right-4 z-40 w-12 h-12 rounded-full bg-slate-800/90 hover:bg-slate-700 border-2 border-slate-600 shadow-lg hover:shadow-xl transition-all hover:scale-110"
        >
          <span className="text-2xl font-bold text-slate-200">?</span>
        </Button>

        {/* Help Modal */}
        {showHelp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in" onClick={() => setShowHelp(false)}>
            <Card className="relative max-w-2xl w-full bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 border-2 border-slate-700 shadow-2xl rounded-3xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
              {/* Decorative gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-purple-500/10 pointer-events-none" />
              
              <div className="relative p-8 sm:p-10">
                {/* Header */}
                <div className="text-center mb-6">
                  <h2 className="text-4xl sm:text-5xl font-black mb-3 bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                    How to Play
                  </h2>
                  <p className="text-slate-300 text-lg">
                    Guess the quarterback from their career stats
                  </p>
                </div>

                {/* Instructions */}
                <div className="space-y-4 mb-8 max-h-96 overflow-y-auto pr-2">
                  <div className="flex gap-4 p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 flex items-center justify-center text-white font-bold text-sm">
                      1
                    </div>
                    <div className="flex-1">
                      <h3 className="text-white font-semibold mb-1">Make Your Guess</h3>
                      <p className="text-slate-300 text-sm">
                        Type a quarterback's name in the input field. You have <span className="font-bold text-white">{MAX_GUESSES} guesses</span> to find the correct player. The current player pool is all quarterbacks with at least 2,000 passing yards since 2010.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-r from-yellow-500 to-orange-500 flex items-center justify-center text-white font-bold text-sm">
                      2
                    </div>
                    <div className="flex-1">
                      <h3 className="text-white font-semibold mb-1">Use Hints</h3>
                      <p className="text-slate-300 text-sm">
                        Click the hint buttons to reveal <span className="font-bold text-white">Seasons</span>, <span className="font-bold text-white">Teams</span>, or <span className="font-bold text-white">Awards</span>.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 flex items-center justify-center text-white font-bold text-sm">
                      3
                    </div>
                    <div className="flex-1">
                      <h3 className="text-white font-semibold mb-1">Get Feedback</h3>
                      <p className="text-slate-300 text-sm mb-2">
                        After each guess, you'll see color-coded feedback:
                      </p>
                      <div className="space-y-2 mt-2">
                        <div className="flex items-center gap-3">
                          <span className="w-5 h-5 rounded-lg bg-yellow-400 shadow-sm" />
                          <span className="text-slate-300 text-sm">Same era (within 2 years of career start)</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="w-5 h-5 rounded-lg bg-orange-400 shadow-sm" />
                          <span className="text-slate-300 text-sm">Shared team (played for the same team at some point)</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="w-5 h-5 rounded-lg bg-green-500 shadow-sm" />
                          <span className="text-slate-300 text-sm">Correct quarterback! 🎉</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-2xl bg-slate-800/50 border border-slate-700">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
                      4
                    </div>
                    <div className="flex-1">
                      <h3 className="text-white font-semibold mb-1">Game Modes</h3>
                      <p className="text-slate-300 text-sm">
                        <span className="font-bold text-white">📅 Daily Mode:</span> Everyone gets the same QB each day.
                        <br />
                        <span className="font-bold text-white">🔄 Unlimited Mode:</span> Play as many random games as you want!
                      </p>
                    </div>
                  </div>
                </div>

                {/* Close Button */}
                <Button
                  onClick={() => setShowHelp(false)}
                  className="w-full h-12 rounded-2xl text-lg font-semibold bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-lg hover:shadow-xl transition-all hover:scale-105"
                >
                  Got it!
                </Button>
              </div>
            </Card>
          </div>
        )}

        {/* Title Section */}
        <div className="text-center mb-8">
          <h1 className="text-5xl sm:text-6xl font-black mb-3 bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent leading-tight px-2">
            Drake Maye-dle
          </h1>
          <p className="text-slate-400 text-lg mb-4">
            Guess the quarterback from their Pro Football Reference page!
          </p>
          
          {/* Game Mode Selector */}
          <div className="flex justify-center gap-2 mb-4">
            <Button
              onClick={() => switchMode("daily")}
              className={`rounded-full px-6 py-2 font-semibold transition-all ${
                gameMode === "daily"
                  ? "bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg"
                  : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              📅 Daily
            </Button>
            <Button
              onClick={() => switchMode("unlimited")}
              className={`rounded-full px-6 py-2 font-semibold transition-all ${
                gameMode === "unlimited"
                  ? "bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg"
                  : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
              }`}
            >
              🔄 Unlimited
            </Button>
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800/60 backdrop-blur-sm rounded-full border border-slate-700">
            <span className="text-2xl font-bold text-white">{guesses.length}</span>
            <span className="text-slate-400">/</span>
            <span className="text-slate-400">{MAX_GUESSES}</span>
            <span className="text-sm text-slate-400 ml-1">guesses</span>
          </div>
        </div>

        {/* Hint Buttons */}
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          <Button
            variant="outline"
            disabled={showSeasons}
            onClick={() => setShowSeasons(true)}
            className="rounded-full px-6 py-5 font-semibold border-2 hover:scale-105 transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed bg-slate-800/80 backdrop-blur-sm"
          >
            {showSeasons ? "✓ Seasons" : "Show Seasons"}
          </Button>
          <Button
            variant="outline"
            disabled={showTeams}
            onClick={() => setShowTeams(true)}
            className="rounded-full px-6 py-5 font-semibold border-2 hover:scale-105 transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed bg-slate-800/80 backdrop-blur-sm"
          >
            {showTeams ? "✓ Teams" : "Show Teams"}
          </Button>
          <Button
            variant="outline"
            disabled={showAwards}
            onClick={() => setShowAwards(true)}
            className="rounded-full px-6 py-5 font-semibold border-2 hover:scale-105 transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed bg-slate-800/80 backdrop-blur-sm"
          >
            {showAwards ? "✓ Awards" : "Show Awards"}
          </Button>
        </div>

        {/* Stats Table */}
        <Card className="mb-8 rounded-3xl shadow-2xl overflow-hidden border-2 border-slate-700 bg-slate-800/80 backdrop-blur-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gradient-to-r from-slate-800 to-slate-900 border-b-2 border-slate-700">
                <tr>
                  {showSeasons && <th className="px-4 py-4 text-left font-bold text-slate-300">Season</th>}
                  {showTeams && <th className="px-4 py-4 text-left font-bold text-slate-300">Team</th>}
                  <th className="px-4 py-4 text-right font-bold text-slate-300">G</th>
                  <th className="px-4 py-4 text-right font-bold text-slate-300">GS</th>
                  <th className="px-4 py-4 text-right font-bold text-slate-300">Cmp</th>
                  <th className="px-4 py-4 text-right font-bold text-slate-300">Att</th>
                  <th className="px-4 py-4 text-right font-bold text-slate-300">Yds</th>
                  <th className="px-4 py-4 text-right font-bold text-slate-300">TD</th>
                  <th className="px-4 py-4 text-right font-bold text-slate-300">Int</th>
                  <th className="px-4 py-4 text-right font-bold text-slate-300">Rate</th>
                  {showAwards && <th className="px-4 py-4 text-right font-bold text-slate-300">Awards</th>}
                </tr>
              </thead>
              <tbody>
                {seasons.map((s, i) => (
                  <tr 
                    key={i} 
                    className="border-b border-slate-700 hover:bg-slate-700/50 transition-colors"
                  >
                    {showSeasons && <td className="px-4 py-3 font-medium text-slate-100">{s.season}</td>}
                    {showTeams && <td className="px-4 py-3 font-medium text-slate-100">{s.team ?? "-"}</td>}
                    <td className="px-4 py-3 text-right text-slate-300">{s.games ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{s.games_started ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{s.completions ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{s.attempts ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{s.yards ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{s.touchdowns ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{s.interceptions ?? "-"}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-100">
                      {s.passer_rating !== null ? s.passer_rating.toFixed(1) : "-"}
                    </td>
                    {showAwards && <td className="px-4 py-3 text-right text-slate-300">{s.awards ?? "-"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Guess Input */}
        <Card className="p-6 mb-8 rounded-3xl shadow-xl border-2 border-slate-700 relative bg-slate-800/80 backdrop-blur-sm">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Input
                value={guess}
                onChange={e => setGuess(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter QB name..."
                disabled={gameWon || gameLost}
                onFocus={() => setShowSuggestions(true)}
                className="h-14 text-lg rounded-2xl border-2 px-6 focus:ring-2 focus:ring-blue-400 bg-slate-900"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 w-full bg-slate-800 border-2 border-slate-700 rounded-2xl shadow-xl mt-2 max-h-64 overflow-y-auto">
                  {suggestions.map(name => (
                    <div
                      key={name}
                      className="px-6 py-3 cursor-pointer hover:bg-slate-700 transition-colors first:rounded-t-2xl last:rounded-b-2xl text-slate-100"
                      onClick={() => {
                        setGuess(name)
                        setSuggestions([])
                        setShowSuggestions(false)
                      }}
                    >
                      {name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Button 
              onClick={submitGuess}
              disabled={!guess.trim() || gameWon || gameLost}
              className="h-14 px-8 rounded-2xl text-lg font-semibold bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-lg hover:shadow-xl transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              Guess
            </Button>
          </div>
        </Card>

        {/* Guesses List */}
        {guesses.length > 0 && (
          <Card className="p-6 mb-8 rounded-3xl shadow-xl border-2 border-slate-700 bg-slate-800/80 backdrop-blur-sm">
            <h2 className="text-2xl font-bold text-white mb-4">Your Guesses</h2>

            <div className="space-y-3">
              {guesses.map((g, i) => {
                let bgClass = "bg-slate-700 text-slate-300"
                if (g.correct) bgClass = "bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg"
                else if (g.teams_overlap) bgClass = "bg-gradient-to-r from-orange-400 to-amber-400 text-white shadow-md"
                else if (g.era === "same") bgClass = "bg-gradient-to-r from-yellow-400 to-yellow-500 text-slate-900 shadow-md"

                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between px-6 py-4 rounded-2xl font-semibold text-lg transition-all ${bgClass}`}
                  >
                    <span>{g.name}</span>
                    <div className="flex items-center gap-3">
                      {g.pfr_id && (
                        <a
                          href={getPfrUrl(g.pfr_id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:opacity-70 transition-opacity"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-5 h-5" />
                        </a>
                      )}
                      {g.correct && <span className="text-2xl">✓</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {/* Game End Card */}
        {(gameWon || gameLost) && (
          <Card className="p-8 rounded-3xl shadow-2xl border-2 border-slate-700 bg-slate-800/90 backdrop-blur-sm">
            <h2 className="text-3xl font-black mb-4 text-white">
              {gameWon ? "🎉 Correct!" : "Game Over"}
            </h2>
            {gameLost && answer && (
              <div className="mb-6">
                <p className="text-lg text-slate-300 mb-2">
                  The correct quarterback was{" "}
                  <span className="font-bold text-blue-400">{answer}</span>
                </p>
                {answerPfrId && (
                  <a
                    href={getPfrUrl(answerPfrId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    View on Pro Football Reference
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <Button 
                onClick={handleShare} 
                className="flex-1 gap-2 h-14 rounded-2xl text-lg font-semibold bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 shadow-lg hover:shadow-xl transition-all hover:scale-105"
              >
                {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                {copied ? "Copied!" : "Share"}
              </Button>
              <Button 
                onClick={() => loadQB(gameMode)} 
                className="flex-1 h-14 rounded-2xl text-lg font-semibold bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 shadow-lg hover:shadow-xl transition-all hover:scale-105"
              >
                New Game
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}