from fastapi import FastAPI, Body, HTTPException
import sqlite3
import pandas as pd
import numpy as np
from fastapi.middleware.cors import CORSMiddleware
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import os
import hashlib

# Timezone for daily puzzle reset (Eastern Time)
EST = ZoneInfo("America/New_York")

app = FastAPI()

# Use environment variable for allowed origins
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.getenv("DB_PATH", "football_wordle.db")

# Database Setup

def init_sessions_table():
    """Create sessions table if it doesn't exist and migrate if needed"""
    with sqlite3.connect(DB_PATH) as conn:
        # Create table if it doesn't exist
        conn.execute("""
            CREATE TABLE IF NOT EXISTS game_sessions (
                session_id TEXT PRIMARY KEY,
                player_id INTEGER NOT NULL,
                game_mode TEXT NOT NULL DEFAULT 'unlimited',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player_id) REFERENCES players(id)
            )
        """)
        
        # Check if game_mode column exists and add it if it doesn't
        cursor = conn.execute("PRAGMA table_info(game_sessions)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if 'game_mode' not in columns:
            conn.execute("""
                ALTER TABLE game_sessions 
                ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'unlimited'
            """)
        
        conn.commit()

# Initialize on startup
init_sessions_table()


# Helpers

def clean_nan(obj):
    if isinstance(obj, dict):
        return {k: clean_nan(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nan(v) for v in obj]
    if obj is None:
        return None
    if isinstance(obj, float) and np.isnan(obj):
        return None
    return obj


def get_player_position(conn, player_id):
    """Get a player's position"""
    cursor = conn.execute(
        "SELECT position FROM players WHERE id = ?",
        (player_id,)
    )
    row = cursor.fetchone()
    return row[0] if row else None


def get_all_valid_players(conn):
    """Get all valid players (QBs, WRs, or RBs with stats)"""
    return pd.read_sql(
        """
        SELECT DISTINCT p.id, p.position
        FROM players p
        WHERE EXISTS (SELECT 1 FROM passing_seasons ps WHERE ps.player_id = p.id)
           OR EXISTS (SELECT 1 FROM receiving_seasons rs WHERE rs.player_id = p.id)
           OR EXISTS (SELECT 1 FROM rushing_seasons rus WHERE rus.player_id = p.id)
        """,
        conn,
    )


def get_daily_player_id(conn):
    """Get a deterministic player ID based on today's date in EST"""
    today = datetime.now(EST).date().isoformat()
    
    # Create a hash from the date to get a consistent random seed
    seed = int(hashlib.md5(today.encode()).hexdigest(), 16) % (2**31)
    
    # Get all valid player IDs (both QBs and WRs)
    player_df = get_all_valid_players(conn)
    
    if player_df.empty:
        return None
    
    # Use numpy with the seed to select a consistent player for today
    np.random.seed(seed)
    idx = np.random.randint(0, len(player_df))
    
    return int(player_df.iloc[idx]["id"])


def get_player_by_name(conn, name):
    df = pd.read_sql(
        """
        SELECT id, name, pfr_id, position
        FROM players
        WHERE LOWER(name) = LOWER(?)
        LIMIT 1
        """,
        conn,
        params=(name,),
    )

    if df.empty:
        return None

    return {
        "id": int(df.iloc[0]["id"]),
        "name": df.iloc[0]["name"],
        "pfr_id": df.iloc[0]["pfr_id"],
        "position": df.iloc[0]["position"]
    }


def get_player_seasons(conn, player_id):
    """Get seasons for a player based on their position"""
    position = get_player_position(conn, player_id)
    
    if position == "QB":
        seasons = pd.read_sql(
            """
            SELECT season, team, games, games_started,
                   completions, attempts, yards,
                   touchdowns, interceptions,
                   passer_rating, awards
            FROM passing_seasons
            WHERE player_id = ?
            ORDER BY season
            """,
            conn,
            params=(player_id,),
        )
    elif position == "WR":
        seasons = pd.read_sql(
            """
            SELECT season, team, games, targets, receptions,
                   yards, yards_per_reception, touchdowns, awards
            FROM receiving_seasons
            WHERE player_id = ?
            ORDER BY season
            """,
            conn,
            params=(player_id,),
        )
    else:  # RB
        seasons = pd.read_sql(
            """
            SELECT season, team, games,
                   attempts, yards, yards_per_attempt, touchdowns,
                   receptions, receiving_yards, awards
            FROM rushing_seasons
            WHERE player_id = ?
            ORDER BY season
            """,
            conn,
            params=(player_id,),
        )
    
    seasons = seasons.where(pd.notnull(seasons), None)
    return seasons, position


def get_player_era(conn, player_id):
    """Get a player's era (first and last season) from any stats table"""
    df = pd.read_sql(
        """
        SELECT MIN(season) AS start, MAX(season) AS end
        FROM (
            SELECT season FROM passing_seasons WHERE player_id = ?
            UNION ALL
            SELECT season FROM receiving_seasons WHERE player_id = ?
            UNION ALL
            SELECT season FROM rushing_seasons WHERE player_id = ?
        )
        """,
        conn,
        params=(player_id, player_id, player_id),
    )
    
    start = df.iloc[0]["start"]
    end = df.iloc[0]["end"]
    
    if start is None or end is None:
        return None, None
    
    return int(start), int(end)


def get_player_teams(conn, player_id):
    """Get all teams a player has played for from any stats table"""
    df = pd.read_sql(
        """
        SELECT DISTINCT team FROM (
            SELECT team FROM passing_seasons WHERE player_id = ?
            UNION
            SELECT team FROM receiving_seasons WHERE player_id = ?
            UNION
            SELECT team FROM rushing_seasons WHERE player_id = ?
        )
        """,
        conn,
        params=(player_id, player_id, player_id),
    )

    return set(df["team"].dropna().tolist())


def create_session(conn, player_id, game_mode="unlimited"):
    """Create a new game session with immediate commit"""
    session_id = str(uuid.uuid4())
    now = datetime.now()
    conn.execute(
        """
        INSERT INTO game_sessions (session_id, player_id, game_mode, created_at, last_accessed)
        VALUES (?, ?, ?, ?, ?)
        """,
        (session_id, player_id, game_mode, now, now)
    )
    conn.commit()
    return session_id


def get_session_player(conn, session_id):
    """Get the player_id for a session"""
    cursor = conn.execute(
        """
        SELECT player_id FROM game_sessions
        WHERE session_id = ?
        """,
        (session_id,)
    )
    
    row = cursor.fetchone()
    if row is None:
        return None
    
    # Update last accessed time
    conn.execute(
        """
        UPDATE game_sessions
        SET last_accessed = ?
        WHERE session_id = ?
        """,
        (datetime.now(), session_id)
    )
    conn.commit()
    
    return row[0]


# Track last cleanup time to avoid running too frequently
_last_cleanup_time = None

def cleanup_old_sessions():
    """Remove sessions older than 72 hours, but only run cleanup every 5 minutes max"""
    global _last_cleanup_time
    
    now = datetime.now()
    # Only run cleanup if it's been at least 5 minutes since last cleanup
    if _last_cleanup_time is not None:
        time_since_cleanup = (now - _last_cleanup_time).total_seconds()
        if time_since_cleanup < 300:  # 5 minutes
            return
    
    _last_cleanup_time = now
    
    with sqlite3.connect(DB_PATH) as conn:
        # Delete sessions older than 72 hours
        cutoff = datetime.now() - timedelta(hours=72)
        # Safety: Never delete sessions less than 2 hours old, even if they appear "old"
        min_age = datetime.now() - timedelta(hours=2)
        conn.execute(
            """
            DELETE FROM game_sessions
            WHERE last_accessed < ?
            AND created_at < ?
            """,
            (cutoff, min_age)
        )
        conn.commit()


# ----------------------
# Routes
# ----------------------

@app.get("/")
def root():
    return {"status": "API running"}


@app.get("/health")
def health_check():
    """Health check endpoint for monitoring"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.get("/daily_qb")
def daily_qb():
    """Start a daily game session with today's player (QB or WR)"""
    
    cleanup_old_sessions()
    
    with sqlite3.connect(DB_PATH) as conn:
        player_id = get_daily_player_id(conn)
        
        if player_id is None:
            raise HTTPException(status_code=500, detail="No playable players found")
        
        # Create session
        session_id = create_session(conn, player_id, game_mode="daily")
        
        # Get seasons based on player position
        seasons, position = get_player_seasons(conn, player_id)
        seasons_dict = seasons.to_dict(orient="records")

    return {
        "session_id": session_id,
        "game_mode": "daily",
        "position": position,
        "seasons": clean_nan(seasons_dict)
    }


@app.get("/random_qb")
def random_qb():
    """Start a new game session with a random player (QB or WR)"""
    import random
    
    cleanup_old_sessions()
    
    with sqlite3.connect(DB_PATH) as conn:
        # Get all valid players (QBs and WRs)
        player_df = get_all_valid_players(conn)

        if player_df.empty:
            raise HTTPException(status_code=500, detail="No playable players found")

        # Truly random selection (not affected by numpy seed)
        idx = random.randint(0, len(player_df) - 1)
        player_id = int(player_df.iloc[idx]["id"])
        
        # Create session
        session_id = create_session(conn, player_id, game_mode="unlimited")
        
        # Get seasons based on player position
        seasons, position = get_player_seasons(conn, player_id)
        seasons_dict = seasons.to_dict(orient="records")

    return {
        "session_id": session_id,
        "game_mode": "unlimited",
        "position": position,
        "seasons": clean_nan(seasons_dict)
    }


@app.post("/guess")
def guess_player(payload: dict = Body(...)):
    """Submit a guess for the current session"""
    
    session_id = payload.get("session_id")
    guess_name = payload.get("guess")
    
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")
    
    if not guess_name:
        raise HTTPException(status_code=400, detail="Missing guess")

    with sqlite3.connect(DB_PATH) as conn:
        # Get the player for this session
        current_player_id = get_session_player(conn, session_id)
        
        if current_player_id is None:
            raise HTTPException(
                status_code=404, 
                detail="Session not found or expired. Please start a new game."
            )

        guessed_player = get_player_by_name(conn, guess_name)
        if guessed_player is None:
            raise HTTPException(status_code=404, detail="Player not found")

        guessed_id = guessed_player["id"]
        pfr_id = guessed_player["pfr_id"]

        if guessed_id == current_player_id:
            return {
                "correct": True,
                "pfr_id": pfr_id
            }

        guess_start, guess_end = get_player_era(conn, guessed_id)
        answer_start, answer_end = get_player_era(conn, current_player_id)

        # Handle case where era couldn't be determined
        if guess_start is None or answer_start is None:
            era_feedback = "far"
        else:
            era_feedback = (
                "same"
                if abs(guess_start - answer_start) <= 2
                else "far"
            )

        guess_teams = get_player_teams(conn, guessed_id)
        answer_teams = get_player_teams(conn, current_player_id)

        teams_overlap = len(guess_teams & answer_teams) > 0

    return {
        "correct": False,
        "pfr_id": pfr_id,
        "feedback": {
            "era": era_feedback,
            "teams_overlap": teams_overlap
        }
    }


@app.post("/reveal")
def reveal(payload: dict = Body(...)):
    """Reveal the answer for the current session"""
    
    session_id = payload.get("session_id")
    
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")

    with sqlite3.connect(DB_PATH) as conn:
        current_player_id = get_session_player(conn, session_id)
        
        if current_player_id is None:
            raise HTTPException(
                status_code=404, 
                detail="Session not found or expired"
            )
        
        df = pd.read_sql(
            "SELECT name, pfr_id, position FROM players WHERE id = ?",
            conn,
            params=(current_player_id,),
        )

    return {
        "name": df.iloc[0]["name"],
        "pfr_id": df.iloc[0]["pfr_id"],
        "position": df.iloc[0]["position"]
    }


@app.get("/autocomplete")
def autocomplete(q: str):
    """Autocomplete player names (includes QBs, WRs, and RBs)"""
    
    if not q or len(q) > 100:
        return {"players": []}
    
    with sqlite3.connect(DB_PATH) as conn:
        df = pd.read_sql(
            """
            SELECT DISTINCT name
            FROM players
            WHERE LOWER(name) LIKE LOWER(?)
            AND (
                EXISTS (SELECT 1 FROM passing_seasons ps WHERE ps.player_id = players.id)
                OR EXISTS (SELECT 1 FROM receiving_seasons rs WHERE rs.player_id = players.id)
                OR EXISTS (SELECT 1 FROM rushing_seasons rus WHERE rus.player_id = players.id)
            )
            ORDER BY name
            LIMIT 10
            """,
            conn,
            params=(f"%{q}%",),
        )

    return {"players": df["name"].tolist()}
