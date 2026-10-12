FROM node:22-alpine

WORKDIR /webmixer

# Install dependencies first so this layer is cached until package files change
COPY package.json package-lock.json ./

RUN npm ci --omit=dev

# Then copy the rest of the source
COPY . .

# Run as non-root; ensure the workdir is writable for config.json
RUN chown -R node:node /webmixer
USER node

ENV OSC_WEBMIXER_BIND_ADDRESS=0.0.0.0 \
    OSC_WEBMIXER_CONFIG_DIR=/webmixer/config \
    OSC_WEBMIXER_DATA_DIR=/webmixer/data
EXPOSE 8080/tcp 8000/udp

ENTRYPOINT [ "node", "." ]
