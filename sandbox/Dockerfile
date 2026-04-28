FROM ubuntu:22.04

RUN apt-get update -q && \
    apt-get install -y --no-install-recommends \
        gcc \
        make \
        libc6-dev \
        libasan6 \
        libubsan1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
