# Gunakan image Node resmi
FROM node:18-slim

# Install dependencies sistem
RUN apt-get update && apt-get install -y \
  wget \
  ca-certificates \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libgdk-pixbuf2.0-0 \
  libnspr4 \
  libnss3 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils \
  --no-install-recommends \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Buat direktori kerja
WORKDIR /app

# Salin file ke container
COPY . .

# Install dependencies
RUN npm install

# Jalankan server
CMD ["node", "server.js"]
