#!bash

if [ -f /tmp/ked/run/slapd.pid ]; then
	kill -INT `cat /tmp/ked/run/slapd.pid`
fi
rm -f ./conf/slapd.d/cn\=config/cn\=schema/* > /dev/null
rm -f -R /tmp/ked/db > /dev/null
rm -f -R /tmp/ked/run > /dev/null

