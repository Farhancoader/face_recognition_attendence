import streamlit as st
import pandas as pd
import time
from datetime import datetime

ts = time.time()
date = datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
timestamp = datetime.fromtimestamp(ts).strftime('%H:%M:%S')

df = pd.read_csv(f"data/attendance_{date}.csv")

st.title("Attendance Sheet")
st.write(f"Date: {date}")
st.write(f"Time: {timestamp}")
st.dataframe(df)
