FROM python:3.12-slim
ENV OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 U2NET_HOME=/models REMBG_HOME=/models NUMBA_CACHE_DIR=/tmp/numba PYTHONUNBUFFERED=1
WORKDIR /worker
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
ARG MODEL_URL=https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx
RUN mkdir -p /models/models/birefnet-general && python -c "import urllib.request; urllib.request.urlretrieve('${MODEL_URL}', '/models/models/birefnet-general/birefnet-general.onnx')" \
 && echo '58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c  /models/models/birefnet-general/birefnet-general.onnx' | sha256sum -c -
COPY worker.py .
USER 65534:65534
ENTRYPOINT ["python", "worker.py"]
