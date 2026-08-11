#!/bin/bash
# Example Vanessa handler. Contract: receives the user's message as $1, prints
# the reply to stdout. Whatever you print is posted back to Slack verbatim.
# Enable with:  VANESSA_HANDLER=~/clawd/claude-agent/vanessa-handlers/echo-bot.sh
PROMPT="$1"
echo "🤖 vanessa (echo bot): you said — ${PROMPT}"
