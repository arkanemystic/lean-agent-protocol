FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    curl git build-essential python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install elan (Lean version manager) pinned to the same toolchain we use
RUN curl https://elan.lean-lang.org/elan-init.sh -sSf | sh -s -- -y --default-toolchain leanprover/lean4:v4.28.0
ENV PATH="/root/.elan/bin:$PATH"

# Pre-warm: confirm toolchain is available
RUN lean --version

# Copy and pre-compile the PolicyEnv lake project so .olean binaries are baked in
WORKDIR /app
COPY PolicyEnv/ ./PolicyEnv/
RUN cd PolicyEnv && lake build

# Install Python HTTP server dependencies
COPY requirements.txt .
RUN pip3 install -r requirements.txt

COPY worker.py .

EXPOSE 9000
CMD ["python3", "worker.py"]
