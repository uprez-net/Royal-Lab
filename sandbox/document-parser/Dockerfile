FROM python:3.13.12-slim@sha256:f1927c75e81efd1e091dbd64b6c0ecaa5630b38635a3d1c04034ac636e1f94c8
RUN pip install --no-cache-dir pypdf==6.19.0
WORKDIR /parser
COPY worker.py /parser/worker.py
USER 65534:65534
ENTRYPOINT ["python", "-I", "-B", "/parser/worker.py"]
