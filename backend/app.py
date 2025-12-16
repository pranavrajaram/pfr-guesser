from fastapi import FastAPI, Body, HTTPException
import sqlite3
import pandas as pd
import numpy as np
from fastapi.middleware.cors import CORSMiddleware
import uuid
from datetime import datetime, timedelta
import os

# ----------------------
# App setup
# ----------------------

app = FastAPI()

# Use environment variable for allowed origins
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.getenv("DB_PATH", "football_wordle.db")

# ----------------------
# Database Setup
# ----------------------

def init_sessions_table():
    """Create sessions table if it doesn't exist"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS game_sessions (
                session_id TEXT PRIMARY KEY,
                player_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (player_id) REFERENCES players(id)
            )
        """)
        conn.commit()

# Initialize on startup
init_sessions_table()


# ----------------------
# Helpers
# ----------------------

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


def get_player_by_name(conn, name):
    df = pd.read_sql(
        """
        SELECT id, name
        FROM players
        WHERE LOWER(name) = LOWER(?)
        LIMIT 1
        """,
        conn,
        params=(name,),
    )

    if df.empty:
        return None

    return int(df.iloc[0]["id"])


def get_player_era(conn, player_id):
    df = pd.read_sql(
        """
        SELECT MIN(season) AS start, MAX(season) AS end
        FROM passing_seasons
        WHERE player_id = ?
        """,
        conn,
        params=(player_id,),
    )

    return int(df.iloc[0]["start"]), int(df.iloc[0]["end"])


def get_player_teams(conn, player_id):
    df = pd.read_sql(
        """
        SELECT DISTINCT team
        FROM passing_seasons
        WHERE player_id = ?
        """,
        conn,
        params=(player_id,),
    )

    return set(df["team"].dropna().tolist())


def create_session(conn, player_id):
    """Create a new game session"""
    session_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO game_sessions (session_id, player_id, created_at, last_accessed)
        VALUES (?, ?, ?, ?)
        """,
        (session_id, player_id, datetime.now(), datetime.now())
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


def cleanup_old_sessions():
    """Remove sessions older than 24 hours"""
    with sqlite3.connect(DB_PATH) as conn:
        cutoff = datetime.now() - timedelta(hours=24)
        conn.execute(
            """
            DELETE FROM game_sessions
            WHERE last_accessed < ?
            """,
            (cutoff,)
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


@app.get("/random_qb")
def random_qb():
    """Start a new game session with a random QB"""
    
    # Clean up old sessions periodically
    cleanup_old_sessions()
    
    with sqlite3.connect(DB_PATH) as conn:
        player_df = pd.read_sql(
            """
            SELECT p.id
            FROM players p
            JOIN passing_seasons ps
              ON p.id = ps.player_id
            GROUP BY p.id
            HAVING COUNT(ps.id) > 0
            ORDER BY RANDOM()
            LIMIT 1
            """,
            conn,
        )

        if player_df.empty:
            raise HTTPException(status_code=500, detail="No playable QBs found")

        player_id = int(player_df.iloc[0]["id"])
        
        # Create session
        session_id = create_session(conn, player_id)

        seasons = pd.read_sql(
            """
            SELECT season, team, games, games_started,
                   completions, attempts, yards,
                   touchdowns, interceptions,
                   passer_rating, qbr, av, awards
            FROM passing_seasons
            WHERE player_id = ?
            ORDER BY season
            """,
            conn,
            params=(player_id,),
        )

        seasons = seasons.where(pd.notnull(seasons), None)
        seasons_dict = seasons.to_dict(orient="records")

    return {
        "session_id": session_id,
        "seasons": clean_nan(seasons_dict)
    }


@app.post("/guess")
def guess_qb(payload: dict = Body(...)):
    """Submit a guess for the current session"""
    
    session_id = payload.get("session_id")
    guess_name = payload.get("guess")
    
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")
    
    if not guess_name:
        raise HTTPException(status_code=400, detail="Missing guess")

    with sqlite3.connect(DB_PATH) as conn:
        # Get the player for this session
        current_qb_id = get_session_player(conn, session_id)
        
        if current_qb_id is None:
            raise HTTPException(
                status_code=404, 
                detail="Session not found or expired. Please start a new game."
            )

        guessed_id = get_player_by_name(conn, guess_name)
        if guessed_id is None:
            raise HTTPException(status_code=404, detail="Player not found")

        if guessed_id == current_qb_id:
            return {"correct": True}

        guess_start, guess_end = get_player_era(conn, guessed_id)
        answer_start, answer_end = get_player_era(conn, current_qb_id)

        era_feedback = (
            "same"
            if abs(guess_start - answer_start) <= 2
            else "far"
        )

        guess_teams = get_player_teams(conn, guessed_id)
        answer_teams = get_player_teams(conn, current_qb_id)

        teams_overlap = len(guess_teams & answer_teams) > 0

    return {
        "correct": False,
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
        current_qb_id = get_session_player(conn, session_id)
        
        if current_qb_id is None:
            raise HTTPException(
                status_code=404, 
                detail="Session not found or expired"
            )
        
        df = pd.read_sql(
            "SELECT name FROM players WHERE id = ?",
            conn,
            params=(current_qb_id,),
        )

    return {"name": df.iloc[0]["name"]}


@app.get("/autocomplete")
def autocomplete(q: str):
    """Autocomplete player names"""
    
    if not q or len(q) > 100:
        return {"players": []}
    
    with sqlite3.connect(DB_PATH) as conn:
        df = pd.read_sql(
            """
            SELECT DISTINCT name
            FROM players
            WHERE LOWER(name) LIKE LOWER(?)
            AND EXISTS (
                SELECT 1
                FROM passing_seasons ps
                WHERE ps.player_id = players.id
            )
            ORDER BY name
            LIMIT 10
            """,
            conn,
            params=(f"%{q}%",),
        )

    return {"players": df["name"].tolist()}