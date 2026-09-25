# Farbcodes für Terminal-Ausgabe
BLUE   = \033[0;34m
GREEN  = \033[0;32m
YELLOW = \033[0;33m
RED    = \033[0;31m
NC     = \033[0m

.PHONY: help setup prod dev logs stop restart shell test

help:
	@echo "$(BLUE)=====================================================$(NC)"
	@echo "$(BLUE) Splity - Verlustfreier Video-Splitter               $(NC)"
	@echo "$(BLUE)=====================================================$(NC)"
	@echo "Verfügbare Befehle:"
	@echo "  $(GREEN)make setup$(NC)    - Initiales Einrichten (.env, Ordner, Docker Build & Start)"
	@echo "  $(GREEN)make prod$(NC)     - Startet den Docker-Container im Hintergrund"
	@echo "  $(GREEN)make dev$(NC)      - Startet lokalen Entwicklungs-Server auf Port 3007"
	@echo "  $(GREEN)make test$(NC)     - Führt Vitest-Unit-Tests aus"
	@echo "  $(GREEN)make logs$(NC)     - Zeigt Live-Logs des Docker-Containers an"
	@echo "  $(GREEN)make stop$(NC)     - Stoppt den Docker-Container"
	@echo "  $(GREEN)make restart$(NC)  - Startet den Docker-Container neu"
	@echo "  $(GREEN)make shell$(NC)    - Öffnet eine Shell im laufenden Container"

setup:
	@echo "$(BLUE)--> Richte Splity ein...$(NC)"
	@if [ ! -f .env ]; then \
		echo "$(YELLOW)Erstelle .env aus .env.example...$(NC)"; \
		cp .env.example .env; \
		if [ "$$(uname)" = "Darwin" ]; then \
			sed -i '' "s/DEINNAME/$$USER/g" .env; \
		else \
			sed -i "s/DEINNAME/$$USER/g" .env; \
		fi; \
	fi
	@if grep -q "DEINNAME" .env || grep -q "//" .env; then \
		echo "$(RED)Fehler: .env enthält noch 'DEINNAME' oder ungültige '//'. Bitte manuell anpassen!$(NC)"; \
		exit 1; \
	fi
	@SPLITY_DIR_PATH=$$(grep '^SPLITY_PATH=' .env | cut -d '=' -f2-); \
	if [ -n "$$SPLITY_DIR_PATH" ]; then \
		echo "$(BLUE)Erstelle Ordner auf dem Mac: $$SPLITY_DIR_PATH/Eingang und $$SPLITY_DIR_PATH/Fertig...$(NC)"; \
		mkdir -p "$$SPLITY_DIR_PATH/Eingang" "$$SPLITY_DIR_PATH/Fertig"; \
	fi
	@echo "$(BLUE)Baue Docker Image...$(NC)"
	docker compose build
	@echo "$(BLUE)Starte Container...$(NC)"
	docker compose up -d
	@echo ""
	@echo "$(GREEN)=====================================================$(NC)"
	@echo "$(GREEN)✓ Splity läuft! Web-App: http://localhost:3006$(NC)"
	@echo "$(GREEN)=====================================================$(NC)"

prod:
	docker compose up -d

dev:
	PORT=3007 npm run dev

test:
	npm test

logs:
	docker compose logs -f

stop:
	docker compose down

restart:
	docker compose restart

shell:
	docker compose exec splity /bin/bash
