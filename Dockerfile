FROM node:18-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
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
  libxshmfence1 \
  libgbm1 \
  xdg-utils \
  wget \
  unzip \
  --no-install-recommends && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Download Chromium (stable snapshot)
RUN wget https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/1181205/chrome-linux.zip && \
    unzip chrome-linux.zip && \
    mv chrome-linux /opt/chromium && \
    ln -s /opt/chromium/chrome /usr/bin/chromium-browser && \
    rm chrome-linux.zip

# Set env var for Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set workdir & install app
WORKDIR /app
COPY . .
RUN npm install

CMD ["npm", "start"]
