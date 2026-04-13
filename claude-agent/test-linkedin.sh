#!/bin/bash
echo "Dropping test note into inbox..."
cat > ~/Library/Mobile\ Documents/iCloud\~md\~obsidian/Documents/MGC/inbox/linkedin-test-$(date +%s).md << 'EOF'
Today I realised that most people overthink their LinkedIn posts.
They spend hours writing the perfect thing when really the best posts
come from just talking out loud for 2 minutes about something that
happened that day. Like this one. I literally just said this into my phone.
EOF
echo "Done. Watching logs..."
tail -f ~/claude-agent/logs/linkedin.log
